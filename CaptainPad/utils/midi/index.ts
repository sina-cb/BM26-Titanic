// Public surface of the MIDI mapping layer + transport selection.
//
// Transport selection is capability-based and explicit (docs/34): native
// CoreMIDI module if present (iPad show path — DEFERRED follow-up) → else Web
// MIDI (desktop Chromium) → else unavailable (a visible state, not an error).

import { MidiTransport } from './transport';
import { WebMidiTransport, isMidiAvailable } from './web_midi_transport';

export * from './transport';
export * from './profile';
export * from './midi_message';
export * from './resolver';
export * from './endpoints';
export * from './coalescer';
export * from './dispatch';
export * from './led_projector';
export * from './manager';
export { WebMidiTransport, isMidiAvailable } from './web_midi_transport';

/** Seam for the deferred native CoreMIDI transport. Always false until the
 *  Expo module lands; kept so the selection logic already reads correctly. */
export function isNativeMidiAvailable(): boolean {
  return false;
}

export type MidiTransportKind = 'native' | 'web' | 'none';

export function getMidiTransportKind(): MidiTransportKind {
  if (isNativeMidiAvailable()) return 'native';
  if (isMidiAvailable()) return 'web';
  return 'none';
}

/** Returns a factory that builds a fresh transport per controller, or null
 *  when MIDI is unavailable on this platform. */
export function selectTransportFactory(): (() => MidiTransport) | null {
  const kind = getMidiTransportKind();
  if (kind === 'web') return () => new WebMidiTransport();
  // 'native' wiring lands with the Expo module (Phase 3).
  return null;
}
