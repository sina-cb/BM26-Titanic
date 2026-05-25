// engineParamsEvents — singleton WS bus for /ws/params.
//
// Carries the CPC firehose split: `sharedParams` (full canonical CPC,
// emitted when an operator turns a knob — quiet by default) and
// `liveParams` (audio-analyser meters, fired at the analyser's
// per-key throttle, ~5-30 Hz).
//
// Consumers (audio meter strips, sharedParams subscribers in
// useEngineState, the audio screen) subscribe here so they don't
// have to pay the cost of parsing the mixer/vis firehose on every
// hop. The control plane (engineEvents) still receives a ONE-SHOT
// `sharedParams` snapshot on connect so UIs reading channel.exports
// paint correct values during the first frame.

import { createBus, type EngineMessage, type BusStatus } from './engineBus';

export type { EngineMessage, BusStatus };

const bus = createBus('/ws/params');

export const engineParamsEvents = {
  subscribe: bus.subscribe,
  subscribeStatus: bus.subscribeStatus,
  getStatus: bus.getStatus,
  /** Params channel is output-only on the engine — there is no
   *  inbound writer wired to it. Use engineEvents.send({ type:
   *  'setSharedParam', … }) for CPC writes. */
  reconnect: bus.reconnect,
};
