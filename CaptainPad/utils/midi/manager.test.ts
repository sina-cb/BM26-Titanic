import { describe, it, expect, vi } from 'vitest';
import { MidiManager, MidiEngineSnapshot } from './manager';
import { MidiTransport, MidiEndpoint, MidiMessageEvent } from './transport';
import { validateProfile } from './profile';
import { MidiDispatchApi } from './dispatch';

const profile = validateProfile({
  device: { id: 'apc', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
  controls: [
    { id: 'fader_1', match: { type: 'cc', channel: 0, cc: 48 }, action: { kind: 'paramCenter', key: 'speed', range: [0, 1] } },
    { id: 'pads', match: { type: 'note', channel: 0, notes: [0, 7] }, action: { kind: 'patternBank', bank: 0 }, led: { active: 21, idle: 1, channel: 6 } },
    { id: 'blackout', match: { type: 'note', channel: 0, notes: [107] }, action: { kind: 'blackoutToggle' }, led: { on: 1, off: 0 } },
  ],
});

const fullEndpoints: MidiEndpoint[] = [
  { id: 'in-0', name: 'APC mini mk2', portIndex: 0, kind: 'source' },
  { id: 'in-1', name: 'MIDIIN2 (APC mini mk2)', portIndex: 1, kind: 'source' },
  { id: 'out-0', name: 'APC mini mk2', portIndex: 0, kind: 'destination' },
  { id: 'out-1', name: 'MIDIOUT2 (APC mini mk2)', portIndex: 1, kind: 'destination' },
];

class FakeTransport implements MidiTransport {
  sent: number[][] = [];
  private endpoints: MidiEndpoint[];
  private msgCbs = new Set<(e: MidiMessageEvent) => void>();
  private epCbs = new Set<() => void>();
  private openedSource: string | null = null;
  private openedDest: string | null = null;

  constructor(endpoints: MidiEndpoint[]) { this.endpoints = endpoints; }
  async listEndpoints() { return this.endpoints; }
  async openSource(id: string) {
    if (!this.endpoints.find((e) => e.id === id && e.kind === 'source')) throw new Error('no source');
    this.openedSource = id;
  }
  async openDestination(id: string) {
    if (!this.endpoints.find((e) => e.id === id && e.kind === 'destination')) throw new Error('no dest');
    this.openedDest = id;
  }
  send(bytes: number[]) {
    if (!this.openedDest) throw new Error('no dest opened');
    this.sent.push(bytes);
  }
  addListener(event: 'midiMessage', cb: (e: MidiMessageEvent) => void): () => void;
  addListener(event: 'endpointsChanged', cb: () => void): () => void;
  addListener(event: 'midiMessage' | 'endpointsChanged', cb: ((e: MidiMessageEvent) => void) | (() => void)) {
    if (event === 'midiMessage') { this.msgCbs.add(cb as (e: MidiMessageEvent) => void); return () => this.msgCbs.delete(cb as (e: MidiMessageEvent) => void); }
    this.epCbs.add(cb as () => void); return () => this.epCbs.delete(cb as () => void);
  }
  close() { this.msgCbs.clear(); this.epCbs.clear(); }

  // ── test helpers ──
  emit(data: number[]) { for (const cb of this.msgCbs) cb({ sourceId: this.openedSource ?? '', data, timestampMs: 0 }); }
  setEndpoints(eps: MidiEndpoint[]) { this.endpoints = eps; for (const cb of this.epCbs) cb(); }
}

function makeApi(): MidiDispatchApi {
  const ok = async () => ({ ok: true });
  return {
    updateParamCenter: vi.fn(ok), updateMixerMaster: vi.fn(ok), setActivePattern: vi.fn(ok),
    setGlobalBlackout: vi.fn(ok), setGlobalEffect: vi.fn(ok), setSectionBrightness: vi.fn(ok),
    setGroupFixedColor: vi.fn(ok), updateMixerChannel: vi.fn(ok),
    dispatchGlobalEffectSlotAction: vi.fn(ok), setGlobalEffectBlackout: vi.fn(ok),
    setChannelPlaylistEntry: vi.fn(ok),
  };
}

function setup(snapshot: MidiEngineSnapshot, endpoints = fullEndpoints) {
  const transport = new FakeTransport(endpoints);
  const api = makeApi();
  const manager = new MidiManager({
    profiles: [profile],
    transportFactory: () => transport,
    api,
    getSnapshot: () => snapshot,
  });
  return { transport, api, manager };
}

const baseSnap: MidiEngineSnapshot = {
  blackout: false, activePattern: null, patterns: ['p0', 'p1', 'p2'], globalEffects: {},
  layers: [], globalEffectSlots: [], colorPalettes: [],
};

describe('MidiManager (integration, fake transport)', () => {
  it('connects and resolves the right endpoints', async () => {
    const { manager } = setup(baseSnap);
    await manager.start();
    const s = manager.getStatuses()[0];
    expect(s.kind).toBe('connected');
    expect(s.sourceName).toBe('APC mini mk2');
  });

  it('dispatches a fader CC to updateParamCenter with the scaled value', async () => {
    const { manager, api, transport } = setup(baseSnap);
    await manager.start();
    transport.emit([0xb0, 48, 127]); // fader 1 full
    expect(api.updateParamCenter).toHaveBeenCalledWith({ speed: 1 });
  });

  it('dispatches a pad press to setActivePattern via the bank', async () => {
    const { manager, api, transport } = setup(baseSnap);
    await manager.start();
    transport.emit([0x90, 1, 127]); // pad index 1 → patterns[1]
    expect(api.setActivePattern).toHaveBeenCalledWith('p1');
  });

  it('toggles blackout (GEM e-stop) on the button press', async () => {
    const { manager, api, transport } = setup({ ...baseSnap, blackout: false });
    await manager.start();
    transport.emit([0x90, 107, 127]);
    expect(api.setGlobalEffectBlackout).toHaveBeenCalledWith(true);
  });

  it('fires onActivity for every inbound message', async () => {
    const transport = new FakeTransport(fullEndpoints);
    const api = makeApi();
    const onActivity = vi.fn();
    const manager = new MidiManager({
      profiles: [profile], transportFactory: () => transport, api,
      getSnapshot: () => baseSnap, onActivity,
    });
    await manager.start();
    transport.emit([0xb0, 48, 10]);
    transport.emit([0x90, 1, 127]);
    expect(onActivity).toHaveBeenCalledTimes(2);
  });

  it('drives mixer layer faders + solo by index, inert when the layer is absent', async () => {
    const layerProfile = validateProfile({
      device: { id: 'apc', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [
          { id: 'f1', match: { type: 'cc', channel: 0, cc: 48 }, action: { kind: 'mixerLayerFader', layer: 0, range: [0, 1] } },
          { id: 'f2', match: { type: 'cc', channel: 0, cc: 49 }, action: { kind: 'mixerLayerFader', layer: 1, range: [0, 1] } },
          { id: 's1', match: { type: 'note', channel: 0, notes: [100] }, action: { kind: 'mixerLayerSolo', layer: 0 }, led: { on: 1, off: 0 } },
        ],
      },
    });
    const snap: MidiEngineSnapshot = {
      ...baseSnap,
      layers: [{ id: 'ch_a', fader: 0.5, solo: false }], // only layer 0 exists
    };
    const transport = new FakeTransport(fullEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [layerProfile], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'mixer',
    });
    await manager.start();
    transport.emit([0xb0, 48, 127]); // layer 0 fader → ch_a
    expect(api.updateMixerChannel).toHaveBeenCalledWith('ch_a', { fader: 1 });
    transport.emit([0xb0, 49, 127]); // layer 1 absent → no-op
    expect(api.updateMixerChannel).toHaveBeenCalledTimes(1);
    transport.emit([0x90, 100, 127]); // solo layer 0
    expect(api.updateMixerChannel).toHaveBeenCalledWith('ch_a', { solo: true });
  });

  it('pad window browser scrolls + selects a layer playlist entry', async () => {
    const browseProfile = validateProfile({
      device: { id: 'apc', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [
          { id: 'down', match: { type: 'column', channel: 0, column: 0, fromRow: 0, toRow: 0 }, action: { kind: 'playlistScroll', layer: 0, dir: 'down' }, led: { on: 1, off: 0 } },
          { id: 'win', match: { type: 'column', channel: 0, column: 0, fromRow: 1, toRow: 6 }, action: { kind: 'playlistWindowSelect', layer: 0 }, led: { active: 21, idle: 1, channel: 6 } },
        ],
      },
    });
    const entries = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}` }));
    const snap: MidiEngineSnapshot = {
      ...baseSnap,
      layers: [{ id: 'ch_a', fader: 1, solo: false, playlist: { entries, activeEntryId: 'e0' } }],
    };
    const windowCalls: [string, number, number][] = [];
    const transport = new FakeTransport(fullEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [browseProfile], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'mixer',
      onWindowChange: (id, start, size) => windowCalls.push([id, start, size]),
    });
    await manager.start();
    transport.emit([0x90, 8, 127]); // column0 row1 = slot 0 → entry e0 (cursor 0)
    expect(api.setChannelPlaylistEntry).toHaveBeenCalledWith('mixer', 'ch_a', 'e0');
    transport.emit([0x90, 0, 127]); // column0 row0 = scroll down → cursor 1
    expect(windowCalls).toContainEqual(['ch_a', 1, 6]);
    transport.emit([0x90, 8, 127]); // slot 0 now → entry e1
    expect(api.setChannelPlaylistEntry).toHaveBeenLastCalledWith('mixer', 'ch_a', 'e1');
  });

  it('scene button dispatches a global-effect slot toggle', async () => {
    const geProfile = validateProfile({
      device: { id: 'apc', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [
          { id: 'ge2', match: { type: 'note', channel: 0, notes: [117] }, action: { kind: 'globalEffectSlot', slot: 2 }, led: { on: 1, off: 0 } },
        ],
      },
    });
    const snap: MidiEngineSnapshot = { ...baseSnap, globalEffectSlots: [{ slot: 1, active: false }, { slot: 2, active: true }] };
    const transport = new FakeTransport(fullEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [geProfile], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'mixer',
    });
    await manager.start();
    transport.emit([0x90, 117, 127]);
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(2, 'toggle');
    // slot 2 active → its scene LED should be lit on connect repaint
    expect(transport.sent).toContainEqual([0x90, 117, 1]);
  });

  it('repaints LEDs on connect (blackout button reflects state)', async () => {
    const { manager, transport } = setup({ ...baseSnap, blackout: true });
    await manager.start();
    expect(transport.sent).toContainEqual([0x90, 107, 1]); // blackout lit
  });

  it('goes disconnected (grey) when the device is unplugged', async () => {
    const { manager, transport } = setup(baseSnap);
    await manager.start();
    expect(manager.getStatuses()[0].kind).toBe('connected');
    transport.setEndpoints([]); // unplug → endpointsChanged
    // onEndpointsChanged re-runs connect(), which is async; allow it to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(manager.getStatuses()[0].kind).toBe('disconnected');
  });

  it('records the last event for the Config-tab monitor', async () => {
    const { manager, transport } = setup(baseSnap);
    await manager.start();
    transport.emit([0xb0, 48, 64]);
    expect(manager.getStatuses()[0].lastEvent).toMatch(/CC ch0 #48 = 64 → fader_1/);
  });

  it('switches mapping when the active context (tab) changes', async () => {
    // Discrete (note) controls dispatch immediately — no coalescer window to
    // confound the assertion. Same note, different action per context.
    const ctxProfile = validateProfile({
      device: { id: 'apc', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        deck: [{ id: 'b1', match: { type: 'note', channel: 0, notes: [7] }, action: { kind: 'blackoutToggle' } }],
        mixer: [{ id: 'b1', match: { type: 'note', channel: 0, notes: [7] }, action: { kind: 'pattern', name: 'mixer_only' } }],
      },
    });
    const transport = new FakeTransport(fullEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [ctxProfile],
      transportFactory: () => transport,
      api,
      getSnapshot: () => baseSnap,
      defaultContext: 'deck',
    });
    await manager.start();
    transport.emit([0x90, 7, 127]); // deck → blackout toggle (GEM e-stop)
    expect(api.setGlobalEffectBlackout).toHaveBeenCalledWith(true);
    expect(api.setActivePattern).not.toHaveBeenCalled();

    manager.setContext('mixer');
    transport.emit([0x90, 7, 127]); // mixer → pattern
    expect(api.setActivePattern).toHaveBeenCalledWith('mixer_only');
  });
});
