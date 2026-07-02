// WebMidiTransport — MidiTransport over navigator.requestMIDIAccess (docs/34
// §1b). Desktop Chromium only; on iPad Safari / native RN there is no Web MIDI
// and isMidiAvailable() reports false (the capability gate, NOT an error).
//
// This is the dev/test transport AND a legitimate degraded FoH mode (a Windows
// laptop running Chrome). The iPad show path is the native CoreMIDI transport,
// a deferred follow-up that implements this SAME interface.
//
// We declare the slice of Web MIDI we use locally rather than depending on
// lib.dom's WebMidi types — the RN/Expo tsconfig doesn't ship them, and this
// keeps the web build's capability gate compiling everywhere.

import {
  MidiEndpoint,
  MidiMessageEvent,
  MidiTransport,
  MidiUnsubscribe,
} from './transport';

// ── Minimal Web MIDI shape ────────────────────────────────────────────────
interface WebMidiPort {
  id: string;
  name: string | null;
  manufacturer?: string | null;
  type: 'input' | 'output';
  state: string;
  connection: string;
}
interface WebMidiInput extends WebMidiPort {
  onmidimessage: ((e: { data: Uint8Array; timeStamp: number }) => void) | null;
}
interface WebMidiOutput extends WebMidiPort {
  send(data: number[] | Uint8Array): void;
}
interface WebMidiAccess {
  inputs: Map<string, WebMidiInput>;
  outputs: Map<string, WebMidiOutput>;
  onstatechange: ((e: { port: WebMidiPort }) => void) | null;
}
interface MidiCapableNavigator {
  requestMIDIAccess(opts?: { sysex?: boolean }): Promise<WebMidiAccess>;
}

/** Capability gate. True only where Web MIDI actually exists (desktop
 *  Chromium). False on iPad Safari, native RN, SSR — a visible "not available
 *  on this platform" state, never an error. */
export function isMidiAvailable(): boolean {
  // Cast through unknown: lib.dom types navigator.requestMIDIAccess as
  // returning the built-in MIDIAccess, which our minimal WebMidiAccess
  // intentionally diverges from. We only probe for the method's existence.
  const nav = (globalThis as unknown as { navigator?: Partial<MidiCapableNavigator> }).navigator;
  return !!nav && typeof nav.requestMIDIAccess === 'function';
}

// One shared MIDIAccess for the whole app — multiple controllers each open
// their own ports off it. statechange is fanned out to every transport so
// hotplug reaches all of them.
let sharedAccess: Promise<WebMidiAccess> | null = null;
const stateChangeListeners = new Set<() => void>();

// Whether to request the SysEx capability. Off by default (a plain MIDI grant
// on desktop Chrome, no scary prompt). A driver that must push a SysEx config
// on connect (the MIDI Fighter Twister's encoder-mode setup, device
// `configureOnConnect`) calls setSysexRequested(true) at boot BEFORE the first
// controller connects, so the single shared MIDIAccess is granted with sysex.
let sysexRequested = false;

/** Request the SysEx capability for the shared MIDIAccess. MUST be called
 *  before the first connect (getAccess memoises the grant). No-op after access
 *  has already been requested. */
export function setSysexRequested(required: boolean): void {
  sysexRequested = sysexRequested || required;
}

function getAccess(): Promise<WebMidiAccess> {
  if (!isMidiAvailable()) {
    return Promise.reject(new Error('Web MIDI is not available on this platform'));
  }
  if (!sharedAccess) {
    const nav = (globalThis as unknown as { navigator: MidiCapableNavigator }).navigator;
    sharedAccess = nav.requestMIDIAccess({ sysex: sysexRequested }).then((access) => {
      access.onstatechange = () => {
        for (const cb of stateChangeListeners) cb();
      };
      return access;
    });
  }
  return sharedAccess;
}

function enumerate(access: WebMidiAccess): MidiEndpoint[] {
  const out: MidiEndpoint[] = [];
  let i = 0;
  for (const inp of access.inputs.values()) {
    out.push({ id: inp.id, name: inp.name ?? '', portIndex: i++, kind: 'source' });
  }
  let o = 0;
  for (const op of access.outputs.values()) {
    out.push({ id: op.id, name: op.name ?? '', portIndex: o++, kind: 'destination' });
  }
  return out;
}

export class WebMidiTransport implements MidiTransport {
  private access: WebMidiAccess | null = null;
  private openedSource: WebMidiInput | null = null;
  private openedDestination: WebMidiOutput | null = null;
  private readonly messageListeners = new Set<(e: MidiMessageEvent) => void>();
  private readonly endpointListeners = new Set<() => void>();
  private readonly onSharedStateChange = () => {
    for (const cb of this.endpointListeners) cb();
  };

  private async ensureAccess(): Promise<WebMidiAccess> {
    if (!this.access) {
      this.access = await getAccess();
      stateChangeListeners.add(this.onSharedStateChange);
    }
    return this.access;
  }

  async listEndpoints(): Promise<MidiEndpoint[]> {
    return enumerate(await this.ensureAccess());
  }

  async openSource(id: string): Promise<void> {
    const access = await this.ensureAccess();
    const input = access.inputs.get(id);
    if (!input) {
      throw new Error(`MIDI input '${id}' is not available`);
    }
    // Detach any previously-opened source first.
    if (this.openedSource && this.openedSource !== input) {
      this.openedSource.onmidimessage = null;
    }
    this.openedSource = input;
    input.onmidimessage = (e) => {
      const evt: MidiMessageEvent = {
        sourceId: id,
        data: Array.from(e.data),
        timestampMs: e.timeStamp,
      };
      for (const cb of this.messageListeners) cb(evt);
    };
  }

  async openDestination(id: string): Promise<void> {
    const access = await this.ensureAccess();
    const output = access.outputs.get(id);
    if (!output) {
      throw new Error(`MIDI output '${id}' is not available`);
    }
    this.openedDestination = output;
  }

  send(bytes: number[]): void {
    if (!this.openedDestination) {
      throw new Error('WebMidiTransport.send called before a destination was opened');
    }
    this.openedDestination.send(bytes);
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
    if (this.openedSource) this.openedSource.onmidimessage = null;
    this.openedSource = null;
    this.openedDestination = null;
    this.messageListeners.clear();
    this.endpointListeners.clear();
    stateChangeListeners.delete(this.onSharedStateChange);
  }
}
