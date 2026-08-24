// captain-midi — local Expo module TS surface.
//
// Mirrors the frozen `MidiTransport` five-call shape declared in
// `CaptainPad/utils/midi/transport.ts`. The native module is present ONLY
// on the iPad (per `expo-module.config.json` → platforms: ["apple"]); on
// desktop web / Android the `NativeCaptainMidi` handle is `null` and the
// capability gate (`isCaptainMidiAvailable`) reports false — a visible state,
// not an error (Codex P0: no fallback behaviours).
//
// SHARED-MODULE, PER-TRANSPORT-OPENED-ID DESIGN
// The native module is one shared handle across all JS `NativeMidiTransport`
// instances: it owns ONE CoreMIDI client + one input port with N sources
// connected. `openSource` / `disconnectSource` scope to a single source id,
// and inbound `midiMessage` events carry the source id so each JS transport
// filters to its own opened source. `send` is stateless — it takes the
// destination id per call.

import { NativeModule, requireOptionalNativeModule } from 'expo';

export type CaptainMidiEndpointKind = 'source' | 'destination';

export interface CaptainMidiEndpoint {
  /** Stable id — CoreMIDI `MIDIUniqueID` when available, else
   *  `name:<kind>:<portIndex>:<display name>`. Deterministic; never
   *  auto-picked by the module. */
  id: string;
  /** CoreMIDI display name (`kMIDIPropertyDisplayName`). */
  name: string;
  /** 0-based position among same-kind endpoints in CoreMIDI enumeration
   *  order — the pin the profile's `sourcePort` / `destinationPort` uses to
   *  disambiguate a multi-port device (e.g. APC mini mk2). */
  portIndex: number;
  kind: CaptainMidiEndpointKind;
}

export interface CaptainMidiMessageEvent {
  /** The id of the source that sent this packet. The native module reads it
   *  from the `srcConnRefCon` set at connect time — always non-empty for a
   *  packet delivered while the source is connected. */
  sourceId: string;
  /** Raw MIDI bytes (0..255). One entry per byte. */
  data: number[];
  /** Monotonic millisecond timestamp derived from CoreMIDI's mach-abs
   *  timestamp, so it can be compared with `performance.now()` on the JS
   *  side (both come from the same host clock). */
  timestampMs: number;
}

/** Event payload types keyed by name (for `NativeModule<E>`). */
export type CaptainMidiEvents = {
  midiMessage: (event: CaptainMidiMessageEvent) => void;
  endpointsChanged: () => void;
};

/** Native module surface — matches the shared-module design above. */
export declare class NativeCaptainMidi extends NativeModule<CaptainMidiEvents> {
  /** Enumerate every source + destination CoreMIDI currently exposes. */
  listEndpoints(): Promise<CaptainMidiEndpoint[]>;
  /** Connect this source to the shared input port. Idempotent per id.
   *  Throws (rejected Promise) with the endpoints ACTUALLY seen when the
   *  requested id is missing — never auto-picks a different port. */
  openSource(id: string): Promise<void>;
  /** Disconnect this source from the shared input port and release its
   *  refCon retain. Safe to call for an id we never opened (no-op). */
  disconnectSource(id: string): Promise<void>;
  /** Validate a destination endpoint exists; throws if gone. CoreMIDI's
   *  send path is stateless, so this is a visibility gate, not a state
   *  change — the JS transport can bail fast on a missing endpoint. */
  openDestination(id: string): Promise<void>;
  /** Send raw bytes to `destinationId`. Validates each byte is 0..255 and
   *  refuses an empty payload. Throws synchronously on any failure. */
  send(destinationId: string, bytes: number[]): void;
  /** Schedule one paced CoreMIDI transaction. Future packet timestamps avoid
   *  overflowing small controller receive queues without blocking JS. */
  sendBatch(destinationId: string, messages: number[][], spacingMs: number): void;
  /** Test / hard-reset helper: disconnect every source this module holds.
   *  The JS transport should NOT rely on this — it uses `disconnectSource`
   *  per opened id so a shared close doesn't kill other controllers'
   *  connections. */
  closeAll(): void;
}

/** The native handle, or `null` on platforms without CoreMIDI. Optional by
 *  design: this file loads on web + Android too (the JS transport index
 *  imports it at the top of the file per the codex "imports at the top"
 *  rule), and the capability gate below is the ONE place that decides
 *  whether to select it. */
export const CaptainMidi: NativeCaptainMidi | null =
  requireOptionalNativeModule<NativeCaptainMidi>('CaptainMidi');

/** Capability gate: true only when the native module is compiled in AND
 *  loaded on the running platform. Read this before touching `CaptainMidi`.
 *  Grey chip / "MIDI not available on this platform" copy when false. */
export function isCaptainMidiAvailable(): boolean {
  return CaptainMidi !== null;
}

export default CaptainMidi;
