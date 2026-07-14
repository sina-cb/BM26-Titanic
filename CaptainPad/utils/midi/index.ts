// Public surface of the MIDI mapping layer + transport selection.
//
// Transport selection is capability-based and explicit (docs/34): native
// CoreMIDI module if present (iPad show path — DEFERRED follow-up) → else Web
// MIDI (desktop Chromium) → else unavailable (a visible state, not an error).

import { MidiTransport } from './transport';
import { WebMidiTransport, isMidiAvailable } from './web_midi_transport';
import { FakeApcDemoTransport, demoFakeMidiRequested } from './fake_demo_transport';

export * from './transport';
export * from './profile';
export * from './midi_message';
export * from './resolver';
export * from './endpoints';
export * from './coalescer';
export * from './dispatch';
export * from './learn';
export * from './led_projector';
export * from './manager';
export { WebMidiTransport, isMidiAvailable, setSysexRequested } from './web_midi_transport';

// Driver #2 — MIDI Fighter Twister protocol port (constants, message
// builders/decoders, sysex config). Re-exported under a namespace so the mft.*
// symbols don't collide with the mapping-layer exports above (e.g. both have
// their own colour/animation vocabularies).
export * as mft from './mft/constants';
export * as mftMessages from './mft/messages';
export * as mftConfig from './mft/config';

/** Seam for the deferred native CoreMIDI transport. Always false until the
 *  Expo module lands; kept so the selection logic already reads correctly. */
export function isNativeMidiAvailable(): boolean {
  return false;
}

export type MidiTransportKind = 'native' | 'web' | 'none';

export function getMidiTransportKind(): MidiTransportKind {
  // Explicit, loud demo gate (?fakeMidi=apc — see fake_demo_transport.ts).
  // Never a fallback: without the URL flag this line is inert.
  if (demoFakeMidiRequested()) return 'web';
  if (isNativeMidiAvailable()) return 'native';
  if (isMidiAvailable()) return 'web';
  return 'none';
}

/** Returns a factory that builds a fresh transport per controller, or null
 *  when MIDI is unavailable on this platform. */
export function selectTransportFactory(): (() => MidiTransport) | null {
  // Explicit demo gate first (see fake_demo_transport.ts — loud, URL-flagged,
  // enumerates a VIRTUAL APC only; real Web MIDI is never touched).
  if (demoFakeMidiRequested()) return () => new FakeApcDemoTransport();
  const kind = getMidiTransportKind();
  if (kind === 'web') return () => new WebMidiTransport();
  // 'native' wiring lands with the Expo module (Phase 3).
  return null;
}
