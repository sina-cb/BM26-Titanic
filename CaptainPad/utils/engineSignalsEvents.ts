// engineSignalsEvents — singleton WS bus for /ws/signals.
//
// Carries `liveParams` only: the audio analyser's derived meters
// (mic*, stems*, tempoBpm) at 15-30 Hz when the mic is hot.
// Per ws_topic_routing.js on the engine side, liveParams is the ONLY
// type ever routed to /ws/signals. Audio meters / BPM badges
// subscribe here so the rest of the UI never sees this traffic.
//
// Why a separate file from engineParamsEvents:
//   engineParamsEvents owns /ws/params (sharedParams — STEADY CPC
//   updates, quiet by default). The signals topic is intentionally
//   separated so a knob touch (params) and a kick detection (signals)
//   can't head-of-line block each other on the iPad's parser.

import { createBus, type EngineMessage, type BusStatus } from './engineBus';

export type { EngineMessage, BusStatus };

const bus = createBus('/ws/signals');

export const engineSignalsEvents = {
  subscribe: bus.subscribe,
  subscribeStatus: bus.subscribeStatus,
  getStatus: bus.getStatus,
  /** Signals channel is output-only on the engine — no inbound writes. */
  reconnect: bus.reconnect,
};
