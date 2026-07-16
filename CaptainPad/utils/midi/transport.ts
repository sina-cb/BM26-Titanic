// MidiTransport — the FROZEN hardware-abstraction boundary (docs/34 §1a).
//
// Two implementations sit behind this single interface:
//   - WebMidiTransport      desktop Chromium, the dev/test + degraded-FoH path
//   - NativeMidiTransport   iPad CoreMIDI Expo module — DEFERRED follow-up
//
// Everything above this line (the mapping layer, LED projector, dispatch, the
// React hook, the per-device drivers) is written ONLY against this interface,
// so layers 2-3 are byte-identical across desktop and iPad. That is the whole
// reason the mapping stack is hardware-in-the-loop testable on Windows today
// and why the native module is a drop-in later. DO NOT widen this surface
// casually — the freeze is what keeps iPad iteration in JS (docs/34 §Ring 2).
//
// Codex P0: no fallbacks. openSource/openDestination throw if the endpoint is
// gone; nothing here ever silently auto-picks an endpoint.

export type MidiEndpointKind = 'source' | 'destination';

/** A single MIDI port as the transport sees it. `portIndex` is the position
 *  among same-kind endpoints in enumeration order — the profile pins a device
 *  by { nameContains, portIndex } (see endpoints.ts). */
export interface MidiEndpoint {
  id: string;
  name: string;
  portIndex: number;
  kind: MidiEndpointKind;
}

/** A raw inbound MIDI message. `data` is the 3 (or n) status/data bytes. */
export interface MidiMessageEvent {
  sourceId: string;
  data: number[];
  timestampMs: number;
}

export type MidiUnsubscribe = () => void;

export interface MidiTransport {
  /** Enumerate every input + output port currently visible. */
  listEndpoints(): Promise<MidiEndpoint[]>;
  /** Open an input port by id and begin emitting 'midiMessage'. Throws if gone. */
  openSource(id: string): Promise<void>;
  /** Open an output port by id for send(). Throws if gone. */
  openDestination(id: string): Promise<void>;
  /** Send raw bytes to the opened destination (LED feedback). */
  send(bytes: number[]): void;
  addListener(event: 'midiMessage', cb: (e: MidiMessageEvent) => void): MidiUnsubscribe;
  addListener(event: 'endpointsChanged', cb: () => void): MidiUnsubscribe;
  /** Release ports + listeners. Idempotent. (Lifecycle helper — the 5-call
   *  freeze of docs/34 is listEndpoints/openSource/openDestination/send/
   *  addListener; close() is teardown both implementations need.) */
  close(): void;
}
