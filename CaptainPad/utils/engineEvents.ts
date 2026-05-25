// engineEvents — singleton control-plane WS bus.
//
// Owns the iPad's ONE connection to /ws/control (engine topic split,
// May 2026). Tabs and components subscribe here for mixer / deck /
// playlist / GEM / autopilot / oscStats / audioStatus events. Prior
// to May 2026, every tab opened its own raw WebSocket and N sockets
// each parsed the full firehose; that doubled-up parsing was what
// starved the 3rd-channel-add path under load. Now there is exactly
// one parse per topic per app, regardless of how many tabs listen.
//
// Migration notes for callers:
//   - subscribe(fn) is unchanged from the pre-split pub/sub.
//   - emit(msg) is retained as a no-op shim for backwards-compat with
//     any test that pretended to be the WS. New code MUST NOT call
//     emit — messages come from the engine over the socket.
//   - To SEND a control message to the engine (formerly
//     `wsRef.current.send(...)`), call engineEvents.send({...}). The
//     queue is bounded so a tap right after foreground doesn't get
//     dropped; if not connected, the message is enqueued and flushed
//     on the next open.
//   - To force a reconnect (e.g. after the API base detector finds a
//     new IP), call engineEvents.reconnect().
//   - To watch connection state for a status pill, use
//     subscribeStatus((s) => …).
//
// The other two topic buses live in their own files:
//   - engineParamsEvents → /ws/params  (sharedParams + liveParams)
//   - engineVizEvents    → /ws/viz     (vis frames + 1Hz stats)

import { createBus, type EngineMessage, type BusStatus } from './engineBus';

export type { EngineMessage, BusStatus };

const bus = createBus('/ws/control');

export const engineEvents = {
  subscribe: bus.subscribe,
  subscribeStatus: bus.subscribeStatus,
  getStatus: bus.getStatus,
  send: bus.send,
  reconnect: bus.reconnect,
  /** No-op shim kept for legacy call sites and a couple of tests that
   *  used to inject synthetic messages into the bus. Messages now
   *  arrive over the WebSocket; nothing else should be emitting. */
  emit(_msg: EngineMessage) { /* no-op */ },
};
