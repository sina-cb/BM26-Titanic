// FakeApcDemoTransport — an EXPLICITLY-REQUESTED, loud, dev/demo-only MIDI
// transport that enumerates a virtual "APC mini mk2" (source + destination,
// port 0) and nothing else.
//
// Why this exists: screenshot/UAT verification of controller-conditional UI
// (the performance-mode sheet's "PRESS SOLO AGAIN TO GO LIVE" row renders only
// while a controller binding `performanceDialog` is CONNECTED). On the show
// box, opening REAL Web MIDI from a second browser instance is forbidden
// territory — the live relay holds the devices and a second holder is exactly
// the VSN1 freeze hazard — so verification drives this fake instead.
//
// Codex P0 (no fallback behaviors): this is NOT a fallback and can never
// activate silently. It is selected ONLY when the page URL carries the literal
// `?fakeMidi=apc` (web builds only), it logs a loud console warning when
// selected, and it neither reads nor writes any real MIDI device. Without the
// flag, transport selection is byte-for-byte the same as before.

import {
  MidiTransport, MidiEndpoint, MidiMessageEvent, MidiUnsubscribe,
} from './transport';

/** True iff the page explicitly requested the fake APC demo transport. */
export function demoFakeMidiRequested(): boolean {
  if (typeof window === 'undefined' || !window.location) return false;
  return /[?&]fakeMidi=apc(&|$)/.test(window.location.search);
}

const FAKE_ENDPOINTS: MidiEndpoint[] = [
  { id: 'fake-apc-in', name: 'APC mini mk2', portIndex: 0, kind: 'source' },
  { id: 'fake-apc-out', name: 'APC mini mk2', portIndex: 0, kind: 'destination' },
];

export class FakeApcDemoTransport implements MidiTransport {
  private msgCbs = new Set<(e: MidiMessageEvent) => void>();
  /** LED bytes the projector sent — kept for debugging in the console. */
  sent: number[][] = [];

  constructor() {
    // Loud by design: a demo transport must never masquerade as hardware.
    // eslint-disable-next-line no-console
    console.warn(
      '[MIDI] FAKE demo transport active (?fakeMidi=apc) — virtual APC mini ' +
      'mk2, no real device is read or written. Remove the URL flag for real MIDI.');
    // Console/driver handle for demo presses. ONE instance is constructed per
    // controller profile (apc/mft/vsn1 all share the factory), so collect them
    // all — only the APC runtime actually matches the fake endpoints and
    // processes events; emitting on the others is inert. Demo SOLO press:
    //   __fakeApcDemos.forEach(t => t.emit([0x90, 113, 127]))
    // Only ever set behind the explicit URL flag (this class can't construct
    // without it), so a real session never carries this global.
    const g = globalThis as Record<string, unknown>;
    const list = (g.__fakeApcDemos as FakeApcDemoTransport[] | undefined) ?? [];
    list.push(this);
    g.__fakeApcDemos = list;
  }

  async listEndpoints(): Promise<MidiEndpoint[]> {
    return FAKE_ENDPOINTS;
  }
  async openSource(_id: string): Promise<void> { /* virtual — nothing to open */ }
  async openDestination(_id: string): Promise<void> { /* virtual */ }
  send(bytes: number[]): void { this.sent.push(bytes); }
  addListener(event: 'midiMessage', cb: (e: MidiMessageEvent) => void): MidiUnsubscribe;
  addListener(event: 'endpointsChanged', cb: () => void): MidiUnsubscribe;
  addListener(
    event: 'midiMessage' | 'endpointsChanged',
    cb: ((e: MidiMessageEvent) => void) | (() => void),
  ): MidiUnsubscribe {
    if (event === 'midiMessage') {
      const l = cb as (e: MidiMessageEvent) => void;
      this.msgCbs.add(l);
      return () => { this.msgCbs.delete(l); };
    }
    return () => undefined;
  }
  close(): void { this.msgCbs.clear(); }

  /** Demo helper: inject a raw inbound message (e.g. a SOLO press from the
   *  browser console: `[0x90, 113, 127]`). */
  emit(data: number[]): void {
    for (const cb of this.msgCbs) cb({ sourceId: 'fake-apc-in', data, timestampMs: Date.now() });
  }
}
