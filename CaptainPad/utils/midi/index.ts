// Public surface of the MIDI mapping layer + transport selection.
//
// Transport selection is capability-based and explicit (docs/34): native
// CoreMIDI module if present (iPad show path — the local Expo module lives
// in `CaptainPad/modules/captain-midi/`) → else Web MIDI (desktop Chromium)
// → else unavailable (a visible state, not an error).

import { MidiTransport } from './transport';
import { WebMidiTransport, isMidiAvailable } from './web_midi_transport';
import { NativeMidiTransport, isNativeMidiTransportAvailable } from './native_midi_transport';
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
export * from './vsn1_layout_feedback';
export * from './manager';
export { WebMidiTransport, isMidiAvailable, setSysexRequested } from './web_midi_transport';
export { NativeMidiTransport, isNativeMidiTransportAvailable } from './native_midi_transport';

// Driver #2 — MIDI Fighter Twister protocol port (constants, message
// builders/decoders, sysex config). Re-exported under a namespace so the mft.*
// symbols don't collide with the mapping-layer exports above (e.g. both have
// their own colour/animation vocabularies).
export * as mft from './mft/constants';
export * as mftMessages from './mft/messages';
export * as mftConfig from './mft/config';

/** Capability gate for the native CoreMIDI transport. Reads the JS-side
 *  handle exported by the local `captain-midi` Expo module — true only on
 *  builds that shipped the module (iOS Release/Preview/Development), false
 *  on desktop web / Android / EAS builds without prebuild. */
export function isNativeMidiAvailable(): boolean {
  return isNativeMidiTransportAvailable();
}

export type MidiTransportKind = 'native' | 'web' | 'none';

export function getMidiTransportKind(): MidiTransportKind {
  // Explicit, loud demo gate (?fakeMidi=apc — see fake_demo_transport.ts).
  // Never a fallback: without the URL flag this line is inert. Uses the
  // 'web' kind label so the Config tab reads sensibly on the desktop demo.
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
  if (kind === 'native') return () => new NativeMidiTransport();
  if (kind === 'web') return () => new WebMidiTransport();
  return null;
}
