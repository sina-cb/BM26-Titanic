// NativeMidiTransport — MidiTransport over the iPadOS CoreMIDI bridge that
// lives in `CaptainPad/modules/captain-midi/`.
//
// This is docs/34 §1a's native transport: byte-for-byte compatible with the
// desktop-Chromium `WebMidiTransport` — same five-call surface, same event
// shapes — so every layer above (mapping, dispatch, LED projector, coalescer,
// the React hook) runs unchanged on the iPad. The whole point of freezing
// `MidiTransport` was that dropping in this file (and flipping the
// capability gate in `index.ts`) is the only difference between Web MIDI on
// a desktop and CoreMIDI on the iPad.
//
// SHARED NATIVE MODULE, PER-TRANSPORT OPENED IDS
// ──────────────────────────────────────────────
// CaptainPad runs multiple controllers (APC + MFT + VSN1) concurrently, each
// with its own `NativeMidiTransport` instance. The native module is ONE
// shared handle — it owns a single CoreMIDI client + one input port with N
// sources connected. This class tracks the source + destination ids IT
// opened and:
//   * routes inbound events only for `openedSourceId` (mirrors Web MIDI's
//     per-input `onmidimessage` scoping), and
//   * passes `openedDestinationId` to `native.send(...)` on every `send()`
//     — CoreMIDI's send path is stateless, so no per-transport destination
//     state lives on the native side.
//
// Codex P0 — no fallbacks: this transport can only be constructed when
// `isNativeMidiTransportAvailable()` is true. A direct instantiation without
// that check throws loudly, never silently no-ops.

import CaptainMidi, {
  CaptainMidiEndpoint,
  CaptainMidiMessageEvent,
  isCaptainMidiAvailable,
} from '@/modules/captain-midi/src';

import {
  MidiEndpoint,
  MidiMessageEvent,
  MidiTransport,
  MidiUnsubscribe,
} from './transport';

/** Capability gate for the native transport. Reads the JS-side handle
 *  exported by the local Expo module: `true` iff the module is compiled in
 *  (iOS build) AND loaded on the running platform. Grey chip / "MIDI not
 *  available on this platform" copy when false — a VISIBLE state, not an
 *  error. */
export function isNativeMidiTransportAvailable(): boolean {
  return isCaptainMidiAvailable();
}

function toMidiEndpoint(e: CaptainMidiEndpoint): MidiEndpoint {
  return {
    id: e.id,
    name: e.name,
    portIndex: e.portIndex,
    kind: e.kind,
  };
}

/** Event subscription handle returned by Expo's NativeModule.addListener. */
interface EventSubscription {
  remove: () => void;
}

export class NativeMidiTransport implements MidiTransport {
  private openedSourceId: string | null = null;
  private openedDestinationId: string | null = null;
  private readonly messageListeners = new Set<(e: MidiMessageEvent) => void>();
  private readonly endpointListeners = new Set<() => void>();
  private messageSubscription: EventSubscription | null = null;
  private endpointsSubscription: EventSubscription | null = null;

  constructor() {
    // Codex P0: this transport must never construct on a platform without
    // the native module. `selectTransportFactory` gates on
    // `isNativeMidiTransportAvailable()`; a direct instantiation without
    // that check is a wiring bug — throw loudly so the caller sees it,
    // never silently no-op.
    if (!CaptainMidi) {
      throw new Error('NativeMidiTransport constructed without the captain-midi module — check isNativeMidiTransportAvailable() first');
    }
    // Route the native module's stream ONCE per transport. `addListener` on
    // an Expo NativeModule returns an EventSubscription with `.remove()`;
    // `close()` disposes both subscriptions.
    this.messageSubscription = CaptainMidi.addListener('midiMessage', (event: CaptainMidiMessageEvent) => {
      // The shared native module fans one event to every subscriber; each
      // transport filters down to ITS opened source's packets (mirrors
      // Web MIDI, where each MIDIInput fires its own `onmidimessage`). A
      // pre-open transport with no `openedSourceId` yet ignores everything.
      if (!this.openedSourceId) return;
      if (event.sourceId !== this.openedSourceId) return;
      const evt: MidiMessageEvent = {
        sourceId: event.sourceId,
        data: event.data,
        timestampMs: event.timestampMs,
      };
      for (const cb of this.messageListeners) cb(evt);
    });
    this.endpointsSubscription = CaptainMidi.addListener('endpointsChanged', () => {
      for (const cb of this.endpointListeners) cb();
    });
  }

  async listEndpoints(): Promise<MidiEndpoint[]> {
    // `CaptainMidi` is non-null by construction (guarded above); the `!`
    // stays so TypeScript treats the following calls as safe.
    const native = CaptainMidi!;
    const raw = await native.listEndpoints();
    return raw.map(toMidiEndpoint);
  }

  async openSource(id: string): Promise<void> {
    const native = CaptainMidi!;
    // The native module throws with the endpoints it actually saw when the
    // requested id is gone — surface the message verbatim (fail loud). We
    // record the id AFTER a successful open so a failure leaves the prior
    // state untouched.
    await native.openSource(id);
    this.openedSourceId = id;
  }

  async openDestination(id: string): Promise<void> {
    const native = CaptainMidi!;
    // openDestination on the native side is a fail-fast existence check;
    // CoreMIDI's send is stateless. We record the id for `send()` to pass
    // in on every call.
    await native.openDestination(id);
    this.openedDestinationId = id;
  }

  send(bytes: number[]): void {
    const native = CaptainMidi!;
    if (!this.openedDestinationId) {
      throw new Error('NativeMidiTransport.send called before a destination was opened');
    }
    // Every byte-range / empty-payload violation surfaces from the native
    // side as a thrown Error — keep the caller's stack close by not
    // wrapping.
    native.send(this.openedDestinationId, bytes);
  }

  sendBatch(messages: number[][], spacingMs: number): void {
    const native = CaptainMidi!;
    if (!this.openedDestinationId) {
      throw new Error('NativeMidiTransport.sendBatch called before a destination was opened');
    }
    native.sendBatch(this.openedDestinationId, messages, spacingMs);
  }

  addListener(event: 'midiMessage', cb: (e: MidiMessageEvent) => void): MidiUnsubscribe;
  addListener(event: 'endpointsChanged', cb: () => void): MidiUnsubscribe;
  addListener(
    event: 'midiMessage' | 'endpointsChanged',
    cb: ((e: MidiMessageEvent) => void) | (() => void),
  ): MidiUnsubscribe {
    if (event === 'midiMessage') {
      const fn = cb as (e: MidiMessageEvent) => void;
      this.messageListeners.add(fn);
      return () => this.messageListeners.delete(fn);
    }
    const fn = cb as () => void;
    this.endpointListeners.add(fn);
    return () => this.endpointListeners.delete(fn);
  }

  close(): void {
    const native = CaptainMidi;
    // Detach our JS listeners first so any in-flight event drops before we
    // ask the native side to release. Idempotent by design (mirrors the
    // Web MIDI transport's close()).
    this.messageListeners.clear();
    this.endpointListeners.clear();
    if (this.messageSubscription) {
      this.messageSubscription.remove();
      this.messageSubscription = null;
    }
    if (this.endpointsSubscription) {
      this.endpointsSubscription.remove();
      this.endpointsSubscription = null;
    }
    // Release just THIS transport's opened source. Destinations are
    // stateless on the native side — clearing our record is enough.
    if (native && this.openedSourceId) {
      // Fire-and-forget: we've already dropped our listeners so there is no
      // way to surface a failure here to a chip, and CoreMIDI disconnect
      // failures are extraordinarily rare. Any throw is intentionally
      // uncaught so a bug is loud in the console.
      void native.disconnectSource(this.openedSourceId);
    }
    this.openedSourceId = null;
    this.openedDestinationId = null;
  }
}
