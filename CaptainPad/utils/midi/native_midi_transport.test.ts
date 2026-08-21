import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MidiMessageEvent } from './transport';

// Hoisted local-Expo-module double. The production binding imports `expo` and
// therefore cannot execute in Vitest's plain Node environment; mocking that
// boundary lets this suite exercise the adapter itself without pretending to
// test CoreMIDI. The Release xcodebuild gate compiles the real Swift module.
const harness = vi.hoisted(() => {
  type Message = { sourceId: string; data: number[]; timestampMs: number };
  type Endpoint = {
    id: string;
    name: string;
    portIndex: number;
    kind: 'source' | 'destination';
  };
  const messageListeners = new Set<(event: Message) => void>();
  const endpointListeners = new Set<() => void>();
  let available = true;

  const native = {
    listEndpoints: vi.fn(async (): Promise<Endpoint[]> => []),
    openSource: vi.fn(async (_id: string) => undefined),
    disconnectSource: vi.fn(async (_id: string) => undefined),
    openDestination: vi.fn(async (_id: string) => undefined),
    send: vi.fn((_destinationId: string, _bytes: number[]) => undefined),
    sendBatch: vi.fn((
      _destinationId: string,
      _messages: number[][],
      _spacingMs: number,
    ) => undefined),
    closeAll: vi.fn(() => undefined),
    addListener: vi.fn((event: string, cb: ((message: Message) => void) | (() => void)) => {
      const listeners = event === 'midiMessage' ? messageListeners : endpointListeners;
      listeners.add(cb as never);
      return { remove: () => listeners.delete(cb as never) };
    }),
  };

  return {
    native,
    messageListeners,
    endpointListeners,
    getAvailable: () => available,
    setAvailable: (next: boolean) => { available = next; },
  };
});

vi.mock('@/modules/captain-midi/src', () => ({
  default: harness.native,
  isCaptainMidiAvailable: harness.getAvailable,
}));

import {
  NativeMidiTransport,
  isNativeMidiTransportAvailable,
} from './native_midi_transport';

function emitMessage(event: { sourceId: string; data: number[]; timestampMs: number }): void {
  for (const listener of harness.messageListeners) listener(event);
}

function emitEndpointsChanged(): void {
  for (const listener of harness.endpointListeners) listener();
}

describe('NativeMidiTransport — local Expo CoreMIDI adapter', () => {
  beforeEach(() => {
    harness.setAvailable(true);
    harness.messageListeners.clear();
    harness.endpointListeners.clear();
    vi.clearAllMocks();
  });

  it('reports the local Expo module capability explicitly', () => {
    expect(isNativeMidiTransportAvailable()).toBe(true);
    harness.setAvailable(false);
    expect(isNativeMidiTransportAvailable()).toBe(false);
  });

  it('maps native endpoints onto the frozen MidiTransport shape', async () => {
    harness.native.listEndpoints.mockResolvedValueOnce([
      { id: 'source-1', name: 'Intech VSN1', portIndex: 0, kind: 'source' },
      { id: 'dest-1', name: 'Intech VSN1', portIndex: 0, kind: 'destination' },
    ]);
    const transport = new NativeMidiTransport();

    await expect(transport.listEndpoints()).resolves.toEqual([
      { id: 'source-1', name: 'Intech VSN1', portIndex: 0, kind: 'source' },
      { id: 'dest-1', name: 'Intech VSN1', portIndex: 0, kind: 'destination' },
    ]);
    transport.close();
  });

  it('filters the shared native event stream to each transport’s opened source', async () => {
    const first = new NativeMidiTransport();
    const second = new NativeMidiTransport();
    const firstEvents: MidiMessageEvent[] = [];
    const secondEvents: MidiMessageEvent[] = [];
    first.addListener('midiMessage', (event) => firstEvents.push(event));
    second.addListener('midiMessage', (event) => secondEvents.push(event));

    await first.openSource('vsn1-source');
    await second.openSource('apc-source');
    emitMessage({ sourceId: 'vsn1-source', data: [0xb0, 16, 64], timestampMs: 10 });
    emitMessage({ sourceId: 'apc-source', data: [0x90, 1, 127], timestampMs: 11 });
    emitMessage({ sourceId: 'unopened-source', data: [0x90, 2, 127], timestampMs: 12 });

    expect(firstEvents).toEqual([
      { sourceId: 'vsn1-source', data: [0xb0, 16, 64], timestampMs: 10 },
    ]);
    expect(secondEvents).toEqual([
      { sourceId: 'apc-source', data: [0x90, 1, 127], timestampMs: 11 },
    ]);
    first.close();
    second.close();
  });

  it('sends to this transport’s destination and fails loudly before open', async () => {
    const transport = new NativeMidiTransport();
    expect(() => transport.send([0x90, 1, 127])).toThrow(/before a destination was opened/);
    expect(() => transport.sendBatch([[0xbd, 0, 65]], 2)).toThrow(
      /before a destination was opened/,
    );

    await transport.openDestination('vsn1-destination');
    transport.send([0xb0, 16, 64]);
    transport.sendBatch([[0xbd, 0, 65], [0xbe, 127, 42]], 2);

    expect(harness.native.openDestination).toHaveBeenCalledWith('vsn1-destination');
    expect(harness.native.send).toHaveBeenCalledWith(
      'vsn1-destination',
      [0xb0, 16, 64],
    );
    expect(harness.native.sendBatch).toHaveBeenCalledWith(
      'vsn1-destination',
      [[0xbd, 0, 65], [0xbe, 127, 42]],
      2,
    );
    transport.close();
  });

  it('fans hotplug events to listeners and removes subscriptions on close', async () => {
    const transport = new NativeMidiTransport();
    const onChanged = vi.fn();
    transport.addListener('endpointsChanged', onChanged);
    await transport.openSource('vsn1-source');

    emitEndpointsChanged();
    expect(onChanged).toHaveBeenCalledTimes(1);

    transport.close();
    await Promise.resolve();
    emitEndpointsChanged();

    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(harness.native.disconnectSource).toHaveBeenCalledWith('vsn1-source');
    expect(harness.native.closeAll).not.toHaveBeenCalled();
  });
});
