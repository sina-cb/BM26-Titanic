// engineBus — singleton WebSocket clients, one per engine topic.
//
// Why this exists:
//   Pre-split, every tab + the RigGlobals provider each opened its own
//   `ws://host:port/` connection. The engine sent every broadcast to
//   every socket, so the iPad's JS thread paid for parsing every
//   audio-analyser tick (15–30 Hz × ~1.5 KB CPC snapshot) and every
//   vis frame (10 Hz × N channels × pixel buffer) just to decide it
//   didn't care about most of them.
//
//   With three mixer channels seeded that added up to enough JSON.parse
//   + React setState churn that the Audio Analysis tab couldn't load
//   its config for 30+ s after mount — the REST `/audio/config`
//   response was sitting in the event loop waiting for the WS handler
//   to finish.
//
// Topic split (matches marsin_engine/lib/ws_topic_routing.js):
//
//   /ws/control — low-volume UI/state. Mixer, deck, autopilot, GEM,
//                 playlist library, audioStatus, oscStats, blackout.
//                 Every tab needs at least one consumer here.
//
//   /ws/params  — sharedParams. CPC steady keys (colors, speed,
//                 gains). Quiet by default; only emits when an
//                 operator turn a knob.
//
//   /ws/signals — liveParams. Audio analyser meters + tempoBpm.
//                 15–30 Hz when the mic is hot. ONLY the audio tab and
//                 the deck BPM badge need this.
//
//   /ws/viz     — vis frames + vis-broadcast-stats. By FAR the highest
//                 volume. ONLY the deck/mixer preview strips subscribe.
//
// Architecture:
//   - One singleton bus per topic, module-level (lives for the app's
//     lifetime). Each bus owns its own WebSocket, auto-reconnects, and
//     fans out parsed messages to its subscribers.
//   - A consumer that needs multiple topics subscribes to each bus
//     individually. There's no "subscribe to all" path on purpose —
//     the whole point of the split is that consumers opt INTO the
//     traffic they want.
//   - `engineEvents` (the legacy unified bus in engineEvents.ts) is
//     also fed by every topic so existing consumers (useEngineState's
//     _onMessage, GlobalEffectMacros, dimmer-rack effects, etc.) keep
//     working without changes. New code should prefer the per-topic
//     buses below — they cost one less hop and one fewer place to
//     filter by `msg.type`.
//
// Lifecycle:
//   `initEngineBuses(apiBase)` must be called once at app boot (the
//   (tabs)/_layout.tsx invokes it via the RigGlobals provider's
//   useEffect). Subsequent calls with the same base are no-ops; calls
//   with a different base tear down and reopen all four sockets (used
//   when the operator switches engine IP in the Config tab).

import { engineEvents, EngineMessage } from '@/utils/engineEvents';

export type EngineTopic = 'control' | 'params' | 'signals' | 'viz';

const TOPIC_PATHS: Record<EngineTopic, string> = {
  control: '/ws/control',
  params:  '/ws/params',
  signals: '/ws/signals',
  viz:     '/ws/viz',
};

type Listener = (msg: EngineMessage) => void;

interface TopicBus {
  topic: EngineTopic;
  subscribe(l: Listener): () => void;
  /** True once the socket has been seen open at least once. */
  isOpen(): boolean;
}

interface InternalBus extends TopicBus {
  listeners: Set<Listener>;
  ws: WebSocket | null;
  open: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  base: string | null;
  closedByUs: boolean;
}

// Reconnect cadence — matches the legacy per-tab WS code. Long enough
// that a real engine restart doesn't hammer the network; short enough
// that the operator doesn't see a "connection lost" UI lingering for
// more than a few seconds.
const RECONNECT_MS = 5_000;

function buildWsUrl(base: string, path: string): string {
  // base looks like `http://10.0.0.42:31168` or `http://localhost:6968`
  // We strip the protocol prefix, keep the host:port intact, and stick
  // the topic path on the end. Never reuse base.split('/') because that
  // would lose the port if the base ever uses a default-port URL.
  const trimmed = base.replace(/\/+$/, '');
  const wsBase = trimmed.replace(/^https?:\/\//, 'ws://').replace(/^wss?:\/\//, 'ws://');
  return `${wsBase}${path}`;
}

function makeBus(topic: EngineTopic): InternalBus {
  const bus: InternalBus = {
    topic,
    listeners: new Set<Listener>(),
    ws: null,
    open: false,
    reconnectTimer: null,
    base: null,
    closedByUs: false,
    subscribe(l: Listener) {
      this.listeners.add(l);
      return () => { this.listeners.delete(l); };
    },
    isOpen() { return this.open; },
  };
  return bus;
}

const buses: Record<EngineTopic, InternalBus> = {
  control: makeBus('control'),
  params:  makeBus('params'),
  signals: makeBus('signals'),
  viz:     makeBus('viz'),
};

function fanout(bus: InternalBus, msg: EngineMessage) {
  // Per-topic subscribers first.
  bus.listeners.forEach((cb) => {
    try { cb(msg); }
    // A buggy subscriber must never break the WS pipeline.
    catch { /* swallow */ }
  });
  // Legacy unified bus — keep feeding so existing consumers
  // (useEngineState._onMessage etc.) don't have to migrate today.
  // engineEvents.emit() already isolates listener errors.
  try { engineEvents.emit(msg); }
  catch { /* swallow */ }
}

function connect(bus: InternalBus) {
  if (!bus.base) return;
  if (bus.ws) {
    try { bus.ws.close(); } catch { /* swallow */ }
    bus.ws = null;
  }
  bus.closedByUs = false;
  const url = buildWsUrl(bus.base, TOPIC_PATHS[bus.topic]);
  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    // URL construction can't really fail here, but we still schedule a
    // reconnect so an unreachable base eventually heals when the engine
    // comes back.
    scheduleReconnect(bus);
    return;
  }
  bus.ws = ws;
  ws.onopen = () => {
    bus.open = true;
  };
  ws.onmessage = (event: MessageEvent<unknown>) => {
    if (typeof event.data !== 'string') return;
    let msg: EngineMessage;
    try { msg = JSON.parse(event.data) as EngineMessage; }
    catch { return; }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return;
    fanout(bus, msg);
  };
  ws.onerror = () => {
    // onerror fires before onclose; do nothing here, let onclose drive
    // the reconnect loop so we don't double-schedule.
  };
  ws.onclose = () => {
    bus.open = false;
    bus.ws = null;
    if (bus.closedByUs) return;
    scheduleReconnect(bus);
  };
}

function scheduleReconnect(bus: InternalBus) {
  if (bus.reconnectTimer) return;
  bus.reconnectTimer = setTimeout(() => {
    bus.reconnectTimer = null;
    connect(bus);
  }, RECONNECT_MS);
}

let _currentBase: string | null = null;

/**
 * Open (or re-open) all four engine sockets against `apiBase`.
 *
 * Idempotent: calling with the same base twice is a no-op. Calling
 * with a new base tears down the previous sockets and opens fresh
 * ones against the new endpoint.
 *
 * Returns the catchall unsubscribe used to cleanly tear down every
 * bus — useful for tests; in production the buses live for the
 * app's lifetime.
 */
export function initEngineBuses(apiBase: string): () => void {
  if (!apiBase || typeof apiBase !== 'string') {
    throw new Error('initEngineBuses: apiBase is required');
  }
  if (_currentBase === apiBase) {
    // Already wired up for this base. Re-arm any bus whose socket
    // closed without a reconnect timer (defensive: should never
    // happen, but cheap insurance).
    for (const topic of Object.keys(buses) as EngineTopic[]) {
      const bus = buses[topic];
      if (!bus.ws && !bus.reconnectTimer) connect(bus);
    }
    return () => teardownAll();
  }
  // Base changed: close everything, reset state, open against the
  // new endpoint. This is hit when the operator switches engine IP
  // in the Config tab.
  teardownAll();
  _currentBase = apiBase;
  for (const topic of Object.keys(buses) as EngineTopic[]) {
    const bus = buses[topic];
    bus.base = apiBase;
    connect(bus);
  }
  return () => teardownAll();
}

function teardownAll() {
  for (const topic of Object.keys(buses) as EngineTopic[]) {
    const bus = buses[topic];
    bus.closedByUs = true;
    if (bus.reconnectTimer) {
      clearTimeout(bus.reconnectTimer);
      bus.reconnectTimer = null;
    }
    if (bus.ws) {
      try { bus.ws.close(); } catch { /* swallow */ }
      bus.ws = null;
    }
    bus.open = false;
  }
  _currentBase = null;
}

/**
 * Per-topic bus. Subscribe to get every message that the engine
 * routes to that topic. The subscriber receives parsed JSON; the
 * legacy `engineEvents` bus still fires for every message too.
 */
export const engineControlBus: TopicBus = buses.control;
export const engineParamsBus:  TopicBus = buses.params;
export const engineSignalsBus: TopicBus = buses.signals;
export const engineVizBus:     TopicBus = buses.viz;

/**
 * True when the control socket has connected at least once. Useful for
 * the "engine offline" pill — control is the canonical "is the engine
 * reachable?" signal because every tab needs it.
 */
export function isControlConnected(): boolean {
  return buses.control.isOpen();
}
