// engineVizEvents — singleton WS bus for /ws/viz.
//
// Carries per-frame `vis` payloads (base64 RGBWAU buffers, one
// entry per channel + 'master' + 'rig', several KB each at the
// engine's vis cadence — 10 Hz by default) and the 1 Hz `stats`
// heartbeat. These are the heaviest broadcasts the engine emits
// and the reason the rest of the WS surface was being starved
// pre-split.
//
// Only the components that actually paint pixels — the PixelStrip
// row in each mixer channel strip, the master strip on the deck,
// the rig visualisation card on the audio screen — subscribe here.
// Tabs that just need UI state (audio settings, dimmer rack,
// playlist library) NEVER subscribe to viz; the viz frames are
// completely invisible to their tick budget.

import { createBus, type EngineMessage, type BusStatus } from './engineBus';

export type { EngineMessage, BusStatus };

const bus = createBus('/ws/viz');

export const engineVizEvents = {
  subscribe: bus.subscribe,
  subscribeStatus: bus.subscribeStatus,
  getStatus: bus.getStatus,
  /** Viz channel is output-only on the engine; reconnect is provided
   *  only for the API-base-rediscovery path. */
  reconnect: bus.reconnect,
};
