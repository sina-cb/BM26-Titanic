import { describe, it, expect, vi } from 'vitest';
import { MidiManager, MidiEngineSnapshot, combineDelta } from './manager';
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
  /** Fire N `endpointsChanged` events WITHOUT changing the endpoint set — models
   *  Web MIDI emitting one statechange per PORT (input + output) for a single
   *  physical plug, all fanned to this transport's listeners. */
  fireEndpointsChanged(times = 1) { for (let i = 0; i < times; i++) for (const cb of this.epCbs) cb(); }
}

function makeApi(): MidiDispatchApi {
  const ok = async () => ({ ok: true });
  return {
    updateParamCenter: vi.fn(ok), updateMixerMaster: vi.fn(ok), setActivePattern: vi.fn(ok),
    setGlobalBlackout: vi.fn(ok), setGlobalEffect: vi.fn(ok), setSectionBrightness: vi.fn(ok),
    setGroupFixedColor: vi.fn(ok), updateMixerChannel: vi.fn(ok), updateDeckChannel: vi.fn(ok),
    dispatchGlobalEffectSlotAction: vi.fn(ok), setGlobalEffectBlackout: vi.fn(ok),
    setChannelPlaylistEntry: vi.fn(ok),
    setDeckChannelControl: vi.fn(ok), setMixerChannelControl: vi.fn(ok),
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
    // 0 ms hotplug debounce (real timers): a statechange settles on the next
    // microtask/tick so `await new Promise((r) => setTimeout(r, 0))` drains it,
    // matching how these APC tests already wait for a reconnect to settle.
    reconnectDebounceMs: 0,
  });
  return { transport, api, manager };
}

const baseSnap: MidiEngineSnapshot = {
  blackout: false, activePattern: null, patterns: ['p0', 'p1', 'p2'], globalEffects: {},
  layers: [], deckLayer: null, activeContext: 'mixer', globalEffectSlots: [], colorPalettes: [],
  focused: null, syncOwnedKeys: new Set<string>(),
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

  it('drives mixer layer faders by index, inert when the layer is absent', async () => {
    const layerProfile = validateProfile({
      device: { id: 'apc', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [
          { id: 'f1', match: { type: 'cc', channel: 0, cc: 48 }, action: { kind: 'mixerLayerFader', layer: 0, range: [0, 1] } },
          { id: 'f2', match: { type: 'cc', channel: 0, cc: 49 }, action: { kind: 'mixerLayerFader', layer: 1, range: [0, 1] } },
        ],
      },
    });
    const snap: MidiEngineSnapshot = {
      ...baseSnap,
      layers: [{ id: 'ch_a', fader: 0.5 }], // only layer 0 exists
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
      layers: [{ id: 'ch_a', fader: 1, playlist: { entries, activeEntryId: 'e0' } }],
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

  it('records the last event for the Config-tab monitor (discrete, raw format)', async () => {
    // A discrete (note) control still records the raw monitor line immediately.
    const { manager, transport } = setup(baseSnap);
    await manager.start();
    transport.emit([0x90, 107, 127]); // blackout note press
    expect(manager.getStatuses()[0].lastEvent).toMatch(/Note On ch0 #107/);
  });

  it('12b: a CONTINUOUS control records its monitor line at FLUSH cadence, not raw rate', async () => {
    // The APC fader is continuous → the raw-rate setStatus is skipped; the
    // coalescer flush records the resolved value (~30 Hz) so React consumers
    // don't re-render >100/s.
    const { manager, transport } = setup(baseSnap);
    await manager.start();
    transport.emit([0xb0, 48, 64]); // fader 1 (paramCenter speed) — leading-edge flush
    expect(manager.getStatuses()[0].lastEvent).toMatch(/speed = 0\.50/);
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

describe('MidiManager — MIDI-learn (arm, apply, focus)', () => {
  // A focused deck channel carrying one binding (CC 51 → sliderGlow). CC 51 is
  // unmapped in the default `profile`, so the profile path resolves nothing and
  // the binding path owns it — the normal faders-4-6 case.
  const deckFocused = (v0 = 0.5): MidiEngineSnapshot => ({
    ...baseSnap,
    activeContext: 'deck',
    deckLayer: { id: 'deck1', fader: 1 },
    focused: {
      role: 'deck', layer: 0, id: 'deck1', entryId: 'entryA',
      key: 'deck:deck1:entryA:m1',
      exports: [{ id: 5, name: 'sliderGlow', v0 }],
      midiMappings: [{
        id: 'm1', enabled: true,
        control: { type: 'cc', channel: 0, number: 51 },
        target: { parameter: 'sliderGlow' }, range: [0, 1],
      }],
    },
  });

  it('armLearn captures the next control and swallows it (no dispatch)', async () => {
    const { manager, api, transport } = setup(deckFocused());
    await manager.start();
    const results: unknown[] = [];
    manager.armLearn((r) => results.push(r));
    transport.emit([0xb0, 51, 100]); // move a fader while armed
    expect(results).toEqual([{ ref: { type: 'cc', channel: 0, number: 51 } }]);
    expect(manager.isLearning()).toBe(false); // auto-disarmed after capture
    // The control was swallowed — the binding on CC 51 must NOT have applied.
    expect(api.setDeckChannelControl).not.toHaveBeenCalled();
  });

  it('applies a learned binding to the focused deck param (within pickup)', async () => {
    const { manager, api, transport } = setup(deckFocused(0.5));
    await manager.start();
    transport.emit([0xb0, 51, 64]); // ~0.504, within eps of the current 0.5 → writes
    expect(api.setDeckChannelControl).toHaveBeenCalledTimes(1);
    const call = (api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(5);
    expect(call[1]).toBeCloseTo(64 / 127, 5);
  });

  it('soft-takeover locks the fader until it crosses the current value', async () => {
    const { manager, api, transport } = setup(deckFocused(0.5));
    await manager.start();
    transport.emit([0xb0, 51, 127]); // 1.0 — far above 0.5 → locked, no write
    expect(api.setDeckChannelControl).not.toHaveBeenCalled();
    transport.emit([0xb0, 51, 0]); // 0.0 — crosses 0.5 → unlocks + writes
    expect(api.setDeckChannelControl).toHaveBeenCalledWith(5, 0);
  });

  it('a disabled binding does not apply', async () => {
    const snap = deckFocused(0.5);
    snap.focused!.midiMappings[0].enabled = false;
    const { manager, api, transport } = setup(snap);
    await manager.start();
    transport.emit([0xb0, 51, 64]);
    expect(api.setDeckChannelControl).not.toHaveBeenCalled();
  });

  it('binding is inert when the param is not on the focused pattern', async () => {
    const snap = deckFocused(0.5);
    snap.focused!.exports = [{ id: 9, name: 'sliderOther', v0: 0.5 }]; // sliderGlow absent
    const { manager, api, transport } = setup(snap);
    await manager.start();
    transport.emit([0xb0, 51, 64]);
    expect(api.setDeckChannelControl).not.toHaveBeenCalled();
  });

  it('a focusChannel track button fires onFocusChange (no engine call)', async () => {
    const focusProfile = validateProfile({
      device: { id: 'apc', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [{ id: 't2', match: { type: 'note', channel: 0, notes: [101] }, action: { kind: 'focusChannel', layer: 1 }, led: { on: 1, off: 0 } }],
      },
    });
    const transport = new FakeTransport(fullEndpoints);
    const api = makeApi();
    const onFocusChange = vi.fn();
    const manager = new MidiManager({
      profiles: [focusProfile], transportFactory: () => transport, api,
      getSnapshot: () => ({ ...baseSnap, layers: [{ id: 'a', fader: 1 }, { id: 'b', fader: 1 }] }),
      defaultContext: 'mixer', onFocusChange,
    });
    await manager.start();
    transport.emit([0x90, 101, 127]);
    expect(onFocusChange).toHaveBeenCalledWith(1);
  });

  // ── 1.1 learn-capture rejects a control that resolves to a profile action ──
  // A profile whose CC 54 is GLOBAL SPEED (a static profile action) and whose
  // CC 51 is unmapped (free to learn).
  const claimingProfile = validateProfile({
    device: { id: 'apc', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
    controls: [
      { id: 'fader_7_speed', match: { type: 'cc', channel: 0, cc: 54 }, action: { kind: 'paramCenter', key: 'speed', range: [0, 1] } },
    ],
  });

  function setupClaiming(snapshot: MidiEngineSnapshot) {
    const transport = new FakeTransport(fullEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [claimingProfile], transportFactory: () => transport, api,
      getSnapshot: () => snapshot,
    });
    return { transport, api, manager };
  }

  it('1.1 rejects learning a control mapped to a profile action (surfaces conflict, no capture)', async () => {
    const { manager, api, transport } = setupClaiming(deckFocused());
    await manager.start();
    const results: unknown[] = [];
    manager.armLearn((r) => results.push(r));
    transport.emit([0xb0, 54, 100]); // CC 54 = GLOBAL SPEED → conflict, not captured
    expect(results).toEqual([{ conflict: 'fader_7_speed' }]);
    expect(manager.isLearning()).toBe(false); // disarmed
    // The profile action did NOT fire while armed (it was swallowed with the conflict).
    expect(api.updateParamCenter).not.toHaveBeenCalledWith({ speed: expect.anything() });
  });

  it('1.1 still captures an unmapped control (CC 51 is free)', async () => {
    const { manager, transport } = setupClaiming(deckFocused());
    await manager.start();
    const results: unknown[] = [];
    manager.armLearn((r) => results.push(r));
    transport.emit([0xb0, 51, 100]); // CC 51 unmapped → captured
    expect(results).toEqual([{ ref: { type: 'cc', channel: 0, number: 51 } }]);
  });

  // ── 1.3 pickup re-locks across an entry switch (same mapping id, new entry) ──
  it('1.3 re-locks pickup when the focused entry changes even if the mapping id repeats', async () => {
    // A mutable snapshot so we can swap the focused entry between emits.
    let snap = deckFocused(0.5);
    const transport = new FakeTransport(fullEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [profile], transportFactory: () => transport, api, getSnapshot: () => snap,
    });
    await manager.start();
    // Unlock on entry A (64/127 ≈ 0.5, within eps → writes).
    transport.emit([0xb0, 51, 64]);
    expect(api.setDeckChannelControl).toHaveBeenCalledTimes(1);
    // Switch to entry B — SAME mapping id 'm1', new entryId → new key → re-lock.
    snap = deckFocused(0.5);
    snap.focused!.entryId = 'entryB';
    snap.focused!.key = 'deck:deck1:entryB:m1';
    transport.emit([0xb0, 51, 127]); // 1.0, far from 0.5 → locked, no write
    expect(api.setDeckChannelControl).toHaveBeenCalledTimes(1); // still 1 — locked
  });

  // ── 1.4 / 1.6 focusing an absent layer is inert (deck-tab track buttons too) ──
  it('1.4 focusChannel on an absent layer does not fire onFocusChange', async () => {
    const focusProfile = validateProfile({
      device: { id: 'apc', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [{ id: 't3', match: { type: 'note', channel: 0, notes: [102] }, action: { kind: 'focusChannel', layer: 2 }, led: { on: 1, off: 0 } }],
      },
    });
    const transport = new FakeTransport(fullEndpoints);
    const api = makeApi();
    const onFocusChange = vi.fn();
    const manager = new MidiManager({
      profiles: [focusProfile], transportFactory: () => transport, api,
      getSnapshot: () => ({ ...baseSnap, layers: [{ id: 'a', fader: 1 }] }), // only layer 0
      defaultContext: 'mixer', onFocusChange,
    });
    await manager.start();
    transport.emit([0x90, 102, 127]); // focus layer 2 — absent → inert
    expect(onFocusChange).not.toHaveBeenCalled();
  });

  it('1.6 a deck-tab track button (layer > 0) is a no-op (layer absent on deck)', async () => {
    const focusProfile = validateProfile({
      device: { id: 'apc', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        deck: [{ id: 't3', match: { type: 'note', channel: 0, notes: [102] }, action: { kind: 'focusChannel', layer: 2 }, led: { on: 1, off: 0 } }],
      },
    });
    const transport = new FakeTransport(fullEndpoints);
    const api = makeApi();
    const onFocusChange = vi.fn();
    const manager = new MidiManager({
      profiles: [focusProfile], transportFactory: () => transport, api,
      getSnapshot: () => ({ ...baseSnap, activeContext: 'deck', deckLayer: { id: 'deck1', fader: 1 } }),
      defaultContext: 'deck', onFocusChange,
    });
    await manager.start();
    transport.emit([0x90, 102, 127]); // deck-tab: layers > 0 don't exist → inert
    expect(onFocusChange).not.toHaveBeenCalled();
  });

  // ── 1.5 discrete NOTE bindings bypass pickup (a pad press is an intent jump) ──
  it('1.5 a learned NOTE binding writes on the first press (no pickup lock)', async () => {
    const snap: MidiEngineSnapshot = {
      ...baseSnap, activeContext: 'deck', deckLayer: { id: 'deck1', fader: 1 },
      focused: {
        role: 'deck', layer: 0, id: 'deck1', entryId: 'e1', key: 'deck:deck1:e1:pad1',
        exports: [{ id: 7, name: 'sliderGlow', v0: 0.0 }],
        midiMappings: [{
          id: 'pad1', enabled: true,
          control: { type: 'note', channel: 0, number: 40 },
          target: { parameter: 'sliderGlow' }, range: [0, 1],
        }],
      },
    };
    const { manager, api, transport } = setup(snap);
    await manager.start();
    // A note press at velocity 127 → value 1.0, far from v0 0.0, but NOTE bypasses
    // pickup → writes immediately.
    transport.emit([0x90, 40, 127]);
    expect(api.setDeckChannelControl).toHaveBeenCalledWith(7, 1);
  });

  // ── 1.2 focus/snapshot staleness gate: mixer bindings locked until the ──────
  //    snapshot's focused layer catches up to the requested layer.
  it('1.2 mixer bindings are swallowed until the snapshot focus catches up', async () => {
    // Profile: a focus track button (layer 1) + a learnable-through-binding CC.
    const p = validateProfile({
      device: { id: 'apc', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [{ id: 't2', match: { type: 'note', channel: 0, notes: [101] }, action: { kind: 'focusChannel', layer: 1 }, led: { on: 1, off: 0 } }],
      },
    });
    // The snapshot's focused still points at layer 0 (async swap hasn't landed).
    const snap: MidiEngineSnapshot = {
      ...baseSnap, activeContext: 'mixer',
      layers: [{ id: 'ch0', fader: 1 }, { id: 'ch1', fader: 1 }],
      focused: {
        role: 'mixer', layer: 0, id: 'ch0', entryId: 'e0', key: 'mixer:ch0:e0:m1',
        exports: [{ id: 3, name: 'glow', v0: 0.5 }],
        midiMappings: [{
          id: 'm1', enabled: true, control: { type: 'cc', channel: 0, number: 51 },
          target: { parameter: 'glow' }, range: [0, 1],
        }],
      },
    };
    const transport = new FakeTransport(fullEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [p], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'mixer',
      onFocusChange: () => { /* async in real life; snapshot stays on layer 0 */ },
    });
    await manager.start();
    transport.emit([0x90, 101, 127]); // request focus layer 1 (sets requestedFocusLayer=1)
    // Snapshot still reports focused.layer 0 ≠ requested 1 → binding swallowed.
    transport.emit([0xb0, 51, 64]);
    expect(api.setMixerChannelControl).not.toHaveBeenCalled();
  });

  it('1.2 once the snapshot focus catches up, bindings flow to the new channel', async () => {
    const p = validateProfile({
      device: { id: 'apc', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
      contexts: {
        mixer: [{ id: 't2', match: { type: 'note', channel: 0, notes: [101] }, action: { kind: 'focusChannel', layer: 1 }, led: { on: 1, off: 0 } }],
      },
    });
    // Mutable snapshot; onFocusChange swaps focused to layer 1 (the async catch-up).
    let snap: MidiEngineSnapshot = {
      ...baseSnap, activeContext: 'mixer',
      layers: [{ id: 'ch0', fader: 1 }, { id: 'ch1', fader: 1 }],
      focused: {
        role: 'mixer', layer: 0, id: 'ch0', entryId: 'e0', key: 'mixer:ch0:e0:m1',
        exports: [{ id: 3, name: 'glow', v0: 0.5 }],
        midiMappings: [{ id: 'm1', enabled: true, control: { type: 'cc', channel: 0, number: 51 }, target: { parameter: 'glow' }, range: [0, 1] }],
      },
    };
    const swapToLayer1 = () => {
      snap = {
        ...snap,
        focused: {
          role: 'mixer', layer: 1, id: 'ch1', entryId: 'e1', key: 'mixer:ch1:e1:m1',
          exports: [{ id: 4, name: 'glow', v0: 0.5 }],
          midiMappings: [{ id: 'm1', enabled: true, control: { type: 'cc', channel: 0, number: 51 }, target: { parameter: 'glow' }, range: [0, 1] }],
        },
      };
    };
    const transport = new FakeTransport(fullEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [p], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'mixer',
      onFocusChange: () => swapToLayer1(), // synchronous swap simulating the catch-up
    });
    await manager.start();
    transport.emit([0x90, 101, 127]); // focus layer 1; snapshot now reports layer 1
    transport.emit([0xb0, 51, 64]); // 0.504 ≈ 0.5 → picks up → writes to ch1's export 4
    expect(api.setMixerChannelControl).toHaveBeenCalledWith('ch1', 4, expect.closeTo(64 / 127, 5));
  });
});

// ── Driver #2 — MIDI Fighter Twister (relative encoders + focus + config) ────
describe('MidiManager — MIDI Fighter Twister', () => {
  // Controllable coalescer timers so we can flush relative-delta windows on demand.
  function makeFakeTimers() {
    let id = 0;
    const armed = new Map<number, () => void>();
    return {
      timers: {
        setTimeout: (cb: () => void) => { const h = ++id; armed.set(h, cb); return h as unknown as ReturnType<typeof setTimeout>; },
        clearTimeout: (h: ReturnType<typeof setTimeout>) => { armed.delete(h as unknown as number); },
      },
      flushDue() { const due = [...armed.entries()]; armed.clear(); for (const [, cb] of due) cb(); },
    };
  }

  const mftEndpoints: MidiEndpoint[] = [
    { id: 'in-0', name: 'Midi Fighter Twister', portIndex: 0, kind: 'source' },
    { id: 'out-0', name: 'Midi Fighter Twister', portIndex: 0, kind: 'destination' },
  ];

  // Bank-1 knobs (relative ch0), pushes (ch1), side buttons (ch3). configureOnConnect
  // ON so we exercise the sysex push.
  const mftProfile = validateProfile({
    device: { id: 'mft', label: 'MIDI Fighter Twister', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0, configureOnConnect: true },
    controls: [
      { id: 'k0_turn', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0, steps: [0.01, 0.05, 0.1] } },
      { id: 'k0_push', match: { type: 'cc', channel: 1, cc: 0 }, action: { kind: 'focusedParamReset', index: 0 } },
      { id: 'f_prev', match: { type: 'cc', channel: 3, cc: 11 }, action: { kind: 'focusStep', dir: 'prev' } },
      { id: 'f_next', match: { type: 'cc', channel: 3, cc: 12 }, action: { kind: 'focusStep', dir: 'next' } },
      { id: 'f_deck', match: { type: 'cc', channel: 3, cc: 13 }, action: { kind: 'focusStep', dir: 'deck' } },
    ],
  });

  const deckFocus = (v0: number): MidiEngineSnapshot => ({
    ...baseSnap,
    activeContext: 'deck',
    deckLayer: { id: 'deck1', fader: 1 },
    focused: {
      role: 'deck', layer: 0, id: 'deck1', entryId: 'e0', key: 'deck:deck1:e0:',
      exports: [{ id: 5, name: 'glow', v0 }],
      midiMappings: [],
    },
  });

  function setupMft(getSnap: () => MidiEngineSnapshot, extra: Partial<{ onFocusChange: (l: number) => void }> = {}) {
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const ft = makeFakeTimers();
    // Separate controllable timer set for the hotplug-reconnect debounce so a
    // test can flush the debounce window on demand (rt.flushDue()).
    const rt = makeFakeTimers();
    const manager = new MidiManager({
      profiles: [mftProfile], transportFactory: () => transport, api,
      getSnapshot: getSnap, defaultContext: 'deck',
      coalescerTimers: ft.timers,
      reconnectTimers: rt.timers,
      onFocusChange: extra.onFocusChange,
    });
    return { transport, api, manager, ft, rt };
  }

  it('pushes the sysex config on connect (many F0..F7 frames)', async () => {
    const { manager, transport } = setupMft(() => deckFocus(0.5));
    await manager.start();
    const sysex = transport.sent.filter((m) => m[0] === 0xf0 && m[m.length - 1] === 0xf7);
    expect(sysex.length).toBeGreaterThan(0);
    expect(manager.getStatuses()[0].kind).toBe('connected');
  });

  it('goes RED (fail-loud) when the transport cannot send sysex', async () => {
    // A transport whose send() throws on a sysex frame (Web MIDI without sysex:true).
    class NoSysexTransport extends FakeTransport {
      send(bytes: number[]) { if (bytes[0] === 0xf0) throw new Error('sysex not permitted'); super.send(bytes); }
    }
    const transport = new NoSysexTransport(mftEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [mftProfile], transportFactory: () => transport, api,
      getSnapshot: () => deckFocus(0.5), defaultContext: 'deck',
    });
    await manager.start();
    const s = manager.getStatuses()[0];
    expect(s.kind).toBe('error');
    expect(s.error).toMatch(/sysex config push failed/);
  });

  // ── #11 hotplug hygiene ──────────────────────────────────────────────────
  // The connect config is a multi-KB sysex burst. It must go out on a genuine
  // disconnected→connected transition for THIS device only — never when some
  // OTHER controller hotplugs (Web MIDI fans an endpointsChanged to every
  // transport) — and a power-cycle (unplug→replug) MUST re-push it so the config
  // survives the replug.
  const countSysex = (t: FakeTransport) => t.sent.filter((m) => m[0] === 0xf0 && m[m.length - 1] === 0xf7).length;
  // Drain the microtask queue enough times for a full async connect() pass
  // (listEndpoints → openSource → openDestination → config send) to settle.
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

  it('#11: does NOT re-push the sysex config when a FOREIGN device hotplugs', async () => {
    const { manager, transport, rt } = setupMft(() => deckFocus(0.5));
    await manager.start();
    const afterConnect = countSysex(transport);
    expect(afterConnect).toBeGreaterThan(0); // configured once on connect

    // A different controller plugs in: Web MIDI fires ≥2 statechange events
    // (input + output ports), fanned to the MFT's transport too. The MFT stayed
    // connected the whole time, so it must NOT be reconfigured.
    transport.fireEndpointsChanged(2);
    rt.flushDue(); // drain the reconnect debounce → one reconnect pass
    await settle(); // let the async pass settle

    expect(countSysex(transport)).toBe(afterConnect); // no extra burst
    expect(manager.getStatuses()[0].kind).toBe('connected');
  });

  it('#11: RE-pushes the sysex config on a genuine power-cycle (unplug→replug)', async () => {
    const { manager, transport, rt } = setupMft(() => deckFocus(0.5));
    await manager.start();
    const afterConnect = countSysex(transport);

    // Unplug: the endpoint set loses the MFT → disconnected, config flag cleared.
    transport.setEndpoints([]);
    rt.flushDue();
    await settle();
    expect(manager.getStatuses()[0].kind).toBe('disconnected');

    // Replug: the MFT reappears → a genuine transition, config MUST re-push.
    transport.setEndpoints(mftEndpoints);
    rt.flushDue();
    await settle();
    expect(manager.getStatuses()[0].kind).toBe('connected');
    expect(countSysex(transport)).toBeGreaterThan(afterConnect); // re-pushed
  });

  it('#11: debounces ≥2 statechange events for one plug into ONE reconnect pass', async () => {
    const { manager, transport, rt } = setupMft(() => deckFocus(0.5));
    await manager.start();
    // Spy on the actual reconnect work: count how many times listEndpoints runs
    // after start(). One physical plug = 2 statechange events = ONE reconnect.
    let listCalls = 0;
    const origList = transport.listEndpoints.bind(transport);
    transport.listEndpoints = async () => { listCalls++; return origList(); };

    transport.fireEndpointsChanged(2); // input + output port events for one plug
    // Both events restart the SAME debounce timer → only one armed timer fires.
    rt.flushDue();
    await settle();

    expect(listCalls).toBe(1); // collapsed to a single reconnect pass
  });

  it('applies a relative knob delta to the focused deck param (current value + delta)', async () => {
    const { manager, api, transport, ft } = setupMft(() => deckFocus(0.5));
    await manager.start();
    transport.emit([0xb0, 0, 65]); // +1 tick → steps[0] = 0.01
    ft.flushDue();                  // accumulate flushes on the trailing window
    expect(api.setDeckChannelControl).toHaveBeenCalledWith(5, expect.closeTo(0.51, 5));
  });

  it('ACCUMULATES deltas within a window (sum, not last-write-wins)', async () => {
    const { manager, api, transport, ft } = setupMft(() => deckFocus(0.5));
    await manager.start();
    transport.emit([0xb0, 0, 65]); // +0.01
    transport.emit([0xb0, 0, 66]); // +0.05 (fast)
    transport.emit([0xb0, 0, 67]); // +0.1 (very fast)
    ft.flushDue();
    // 0.5 + (0.01 + 0.05 + 0.1) = 0.66 — one write with the SUM, not just +0.1.
    expect(api.setDeckChannelControl).toHaveBeenCalledTimes(1);
    expect(api.setDeckChannelControl).toHaveBeenCalledWith(5, expect.closeTo(0.66, 5));
  });

  it('clamps the applied value to [0, 1]', async () => {
    const { manager, api, transport, ft } = setupMft(() => deckFocus(0.98));
    await manager.start();
    transport.emit([0xb0, 0, 67]); // +0.1 → 1.08 → clamped to 1
    ft.flushDue();
    expect(api.setDeckChannelControl).toHaveBeenCalledWith(5, 1);
  });

  it('a knob with no param behind it is inert (no write)', async () => {
    const { manager, api, transport, ft } = setupMft(() => ({ ...deckFocus(0.5), focused: { ...deckFocus(0.5).focused!, exports: [] } }));
    await manager.start();
    transport.emit([0xb0, 0, 65]);
    ft.flushDue();
    expect(api.setDeckChannelControl).not.toHaveBeenCalled();
  });

  it('an unknown relative CC value (not 61-67) writes nothing (loud silence)', async () => {
    const { manager, api, transport, ft } = setupMft(() => deckFocus(0.5));
    await manager.start();
    transport.emit([0xb0, 0, 64]); // no-movement code
    ft.flushDue();
    expect(api.setDeckChannelControl).not.toHaveBeenCalled();
  });

  it('focusStep next/prev is clamped to the existing layers (no wrap)', async () => {
    const onFocusChange = vi.fn();
    // Mixer context with two layers; focus starts at 0.
    const snap: MidiEngineSnapshot = {
      ...baseSnap, activeContext: 'mixer',
      layers: [{ id: 'ch0', fader: 1 }, { id: 'ch1', fader: 1 }],
      focused: { role: 'mixer', layer: 0, id: 'ch0', entryId: 'e', key: 'mixer:ch0:e:', exports: [], midiMappings: [] },
    };
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [mftProfile], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'mixer', onFocusChange,
    });
    await manager.start();
    transport.emit([0xb3, 11, 127]); // prev from 0 → -1 → clamped, inert
    expect(onFocusChange).not.toHaveBeenCalled();
    transport.emit([0xb3, 12, 127]); // next from 0 → 1 (exists) → focus 1
    expect(onFocusChange).toHaveBeenCalledWith(1);
  });

  it('focusStep deck jumps to layer 0', async () => {
    const onFocusChange = vi.fn();
    const snap: MidiEngineSnapshot = {
      ...baseSnap, activeContext: 'mixer',
      layers: [{ id: 'ch0', fader: 1 }, { id: 'ch1', fader: 1 }],
      focused: { role: 'mixer', layer: 1, id: 'ch1', entryId: 'e', key: 'mixer:ch1:e:', exports: [], midiMappings: [] },
    };
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [mftProfile], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'mixer', onFocusChange,
    });
    await manager.start();
    transport.emit([0xb3, 13, 127]); // deck → layer 0
    expect(onFocusChange).toHaveBeenCalledWith(0);
  });

  it('tracks the active bank from a ch3 bank-change (no write, updates status)', async () => {
    const { manager, transport } = setupMft(() => deckFocus(0.5));
    await manager.start();
    transport.emit([0xb3, 1, 127]); // bank 2 (CC 1 = BANK2)
    expect(manager.getStatuses()[0].lastEvent).toMatch(/MFT bank 2/);
  });

  it('encoder push with no saved default is a documented no-op (deferred reset)', async () => {
    const { manager, api, transport } = setupMft(() => deckFocus(0.5));
    await manager.start();
    transport.emit([0xb1, 0, 127]); // push knob 0 — export has no defaultValue
    expect(api.setDeckChannelControl).not.toHaveBeenCalled();
    expect(manager.getStatuses()[0].lastEvent).toMatch(/no saved default/);
  });

  it('encoder push resets to a saved default when the export carries one', async () => {
    const snap = (): MidiEngineSnapshot => ({
      ...deckFocus(0.9),
      focused: { ...deckFocus(0.9).focused!, exports: [{ id: 5, name: 'glow', v0: 0.9, defaultValue: 0.3 }] },
    });
    const { manager, api, transport } = setupMft(snap);
    await manager.start();
    transport.emit([0xb1, 0, 127]); // push → reset glow to 0.3
    expect(api.setDeckChannelControl).toHaveBeenCalledWith(5, 0.3);
  });

  // ── Task 1: a knob delta anchors on the modulation BASE, not the moving value ──
  it('applies the delta to the modulation base (not v0) for a modulated param', async () => {
    // base 0.3 (operator set value), v0 0.8 (post-modulation moving value). A +0.01
    // tick must land on the BASE → 0.31, NOT on v0 → 0.81.
    const snap = (): MidiEngineSnapshot => ({
      ...deckFocus(0.8),
      focused: { ...deckFocus(0.8).focused!, exports: [{ id: 5, name: 'glow', v0: 0.8, base: 0.3, modulated: true }] },
    });
    const { manager, api, transport, ft } = setupMft(snap);
    await manager.start();
    transport.emit([0xb0, 0, 65]); // +1 tick → steps[0] = 0.01
    ft.flushDue();
    expect(api.setDeckChannelControl).toHaveBeenCalledWith(5, expect.closeTo(0.31, 5));
  });

  it('falls back to v0 when the export carries no base (unmodulated param)', async () => {
    const { manager, api, transport, ft } = setupMft(() => deckFocus(0.5)); // no base
    await manager.start();
    transport.emit([0xb0, 0, 65]); // +0.01 → 0.51 off v0
    ft.flushDue();
    expect(api.setDeckChannelControl).toHaveBeenCalledWith(5, expect.closeTo(0.51, 5));
  });

  // ── Task 3: speed-sync gates a paramCenterDelta with key 'speed' ──
  const mftGlobalProfile = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0, configureOnConnect: true },
    controls: [
      { id: 'g_speed', match: { type: 'cc', channel: 0, cc: 16, relative: true }, action: { kind: 'paramCenterRelative', key: 'speed', steps: [0.01, 0.05, 0.1] } },
      { id: 'g_size', match: { type: 'cc', channel: 0, cc: 17, relative: true }, action: { kind: 'paramCenterRelative', key: 'size', steps: [0.01, 0.05, 0.1] } },
    ],
  });

  function setupGlobalMft(getSnap: () => MidiEngineSnapshot) {
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const ft = makeFakeTimers();
    const manager = new MidiManager({
      profiles: [mftGlobalProfile], transportFactory: () => transport, api,
      getSnapshot: getSnap, defaultContext: 'deck', coalescerTimers: ft.timers,
    });
    return { transport, api, manager, ft };
  }

  it('speed-sync ON → a speed knob delta is INERT (swallow, no write)', async () => {
    const snap: MidiEngineSnapshot = {
      ...baseSnap, globalParamValues: { speed: 0.5, size: 0.5 },
      bpmSpeedSyncOn: true, syncOwnedKeys: new Set(['speed']),
    };
    const { manager, api, transport, ft } = setupGlobalMft(() => snap);
    await manager.start();
    transport.emit([0xb0, 16, 65]); // +0.01 on speed
    ft.flushDue();
    expect(api.updateParamCenter).not.toHaveBeenCalled();
    expect(manager.getStatuses()[0].lastEvent).toMatch(/sync owns it/);
  });

  it('speed-sync OFF → a speed knob delta writes normally', async () => {
    const snap: MidiEngineSnapshot = {
      ...baseSnap, globalParamValues: { speed: 0.5, size: 0.5 },
      bpmSpeedSyncOn: false, syncOwnedKeys: new Set<string>(),
    };
    const { manager, api, transport, ft } = setupGlobalMft(() => snap);
    await manager.start();
    transport.emit([0xb0, 16, 65]); // +0.01 → 0.51
    ft.flushDue();
    expect(api.updateParamCenter).toHaveBeenCalledWith({ speed: expect.closeTo(0.51, 5) });
  });

  it('speed-sync ON gates only speed — a size knob delta still writes', async () => {
    const snap: MidiEngineSnapshot = {
      ...baseSnap, globalParamValues: { speed: 0.5, size: 0.5 },
      bpmSpeedSyncOn: true, syncOwnedKeys: new Set(['speed']),
    };
    const { manager, api, transport, ft } = setupGlobalMft(() => snap);
    await manager.start();
    transport.emit([0xb0, 17, 65]); // +0.01 on size
    ft.flushDue();
    expect(api.updateParamCenter).toHaveBeenCalledWith({ size: expect.closeTo(0.51, 5) });
  });
});

// ── D1 findings (meta-review Part A/B): #3, #2, #4, #7, N3, 8a, 8b ───────────
describe('MidiManager — D1 meta-review fixes', () => {
  function makeFakeTimers() {
    let id = 0;
    const armed = new Map<number, () => void>();
    return {
      timers: {
        setTimeout: (cb: () => void) => { const h = ++id; armed.set(h, cb); return h as unknown as ReturnType<typeof setTimeout>; },
        clearTimeout: (h: ReturnType<typeof setTimeout>) => { armed.delete(h as unknown as number); },
      },
      flushDue() { const due = [...armed.entries()]; armed.clear(); for (const [, cb] of due) cb(); },
    };
  }

  const mftEndpoints: MidiEndpoint[] = [
    { id: 'in-0', name: 'Midi Fighter Twister', portIndex: 0, kind: 'source' },
    { id: 'out-0', name: 'Midi Fighter Twister', portIndex: 0, kind: 'destination' },
  ];

  // Knob 0 turn + push (reset). Turn control id is 'k0_turn'.
  const mftProfile = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
    controls: [
      { id: 'k0_turn', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0, steps: [0.01, 0.05, 0.1] } },
      { id: 'k0_push', match: { type: 'cc', channel: 1, cc: 0 }, action: { kind: 'focusedParamReset', index: 0 } },
    ],
  });

  // ── #3 fast-turn undershoot: optimistic anchor accumulates across windows ──
  it('#3 focusedParamDelta accumulates across windows off the LOCAL optimistic value, not the lagging snapshot', async () => {
    // Snapshot is FROZEN at 0.5 (the engine echo hasn't caught up — the fast
    // sweep's ~150 ms lag). Without the optimistic anchor each window re-seeds
    // from 0.5 and every flush lands ~0.51, losing the whole sweep. With it, the
    // three windows accumulate to 0.53.
    const snap: MidiEngineSnapshot = {
      ...baseSnap, activeContext: 'deck', deckLayer: { id: 'd1', fader: 1 },
      focused: { role: 'deck', layer: 0, id: 'd1', entryId: 'e', key: 'deck:d1:e:', exports: [{ id: 5, name: 'glow', v0: 0.5 }], midiMappings: [] },
    };
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const ft = makeFakeTimers();
    const manager = new MidiManager({
      profiles: [mftProfile], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'deck', coalescerTimers: ft.timers,
    });
    await manager.start();
    transport.emit([0xb0, 0, 65]); ft.flushDue(); // window 1: 0.5 + 0.01 = 0.51
    transport.emit([0xb0, 0, 65]); ft.flushDue(); // window 2: 0.51 + 0.01 = 0.52 (NOT 0.51)
    transport.emit([0xb0, 0, 65]); ft.flushDue(); // window 3: 0.53
    const calls = (api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1][1]).toBeCloseTo(0.53, 5);
  });

  it('#3 re-seeds the optimistic anchor on an external snapshot jump (reset/other surface)', async () => {
    // The snapshot JUMPS between windows (an external write) — the anchor must
    // re-seed to the new snapshot, not keep drifting off the stale optimistic.
    let v0 = 0.5;
    const snap = (): MidiEngineSnapshot => ({
      ...baseSnap, activeContext: 'deck', deckLayer: { id: 'd1', fader: 1 },
      focused: { role: 'deck', layer: 0, id: 'd1', entryId: 'e', key: 'deck:d1:e:', exports: [{ id: 5, name: 'glow', v0 }], midiMappings: [] },
    });
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const ft = makeFakeTimers();
    const manager = new MidiManager({
      profiles: [mftProfile], transportFactory: () => transport, api,
      getSnapshot: snap, defaultContext: 'deck', coalescerTimers: ft.timers,
    });
    await manager.start();
    transport.emit([0xb0, 0, 65]); ft.flushDue(); // 0.5 → 0.51 (optimistic now 0.51)
    v0 = 0.9;                                      // external jump (> epsilon 0.15)
    transport.emit([0xb0, 0, 65]); ft.flushDue(); // re-seed from 0.9 → 0.91
    const calls = (api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1][1]).toBeCloseTo(0.91, 5);
  });

  it('#3 paramCenterDelta also accumulates off the optimistic value across windows', async () => {
    const globalProfile = validateProfile({
      device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      controls: [{ id: 'g0', match: { type: 'cc', channel: 0, cc: 16, relative: true }, action: { kind: 'paramCenterRelative', key: 'size', steps: [0.01, 0.05, 0.1] } }],
    });
    const snap: MidiEngineSnapshot = { ...baseSnap, globalParamValues: { size: 0.5 } }; // frozen echo
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const ft = makeFakeTimers();
    const manager = new MidiManager({
      profiles: [globalProfile], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'deck', coalescerTimers: ft.timers,
    });
    await manager.start();
    transport.emit([0xb0, 16, 65]); ft.flushDue(); // 0.5 → 0.51
    transport.emit([0xb0, 16, 65]); ft.flushDue(); // 0.51 → 0.52 (NOT 0.51)
    const calls = (api.updateParamCenter as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1][0]).toEqual({ size: expect.closeTo(0.52, 5) });
  });

  // ── #4 sync gate at shared depth: ABSOLUTE paramCenter path also gated ──
  it('#4 an ABSOLUTE paramCenter fader on a sync-owned key is INERT (shared gate, not just the delta path)', async () => {
    const apcProfile = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      controls: [{ id: 'fader7', match: { type: 'cc', channel: 0, cc: 54 }, action: { kind: 'paramCenter', key: 'speed', range: [0, 1] } }],
    });
    const snap: MidiEngineSnapshot = { ...baseSnap, syncOwnedKeys: new Set(['speed']) };
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [apcProfile], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'deck',
    });
    await manager.start();
    transport.emit([0xb0, 54, 127]); // absolute fader → speed, but sync owns it
    expect(api.updateParamCenter).not.toHaveBeenCalled();
    expect(manager.getStatuses()[0].lastEvent).toMatch(/sync owns it/);
  });

  it('#4 the same absolute fader writes when the key is NOT sync-owned', async () => {
    const apcProfile = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      controls: [{ id: 'fader7', match: { type: 'cc', channel: 0, cc: 54 }, action: { kind: 'paramCenter', key: 'speed', range: [0, 1] } }],
    });
    const snap: MidiEngineSnapshot = { ...baseSnap, syncOwnedKeys: new Set<string>() };
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [apcProfile], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'deck',
    });
    await manager.start();
    transport.emit([0xb0, 54, 127]);
    expect(api.updateParamCenter).toHaveBeenCalledWith({ speed: 1 });
  });

  // ── #2 focus single-source-of-truth: setFocusIntent clears a stale request ──
  it('#2 setFocusIntent (touch) clears a stale MIDI focus request so later bindings are NOT swallowed', async () => {
    // A focus that no bound fader follows must NOT leave requestedFocusLayer
    // permanently stale (the old bug: only applyBinding cleared it). After the
    // snapshot catches up, effectiveFocusLayer clears the request; a binding on
    // the now-focused channel flows.
    let snap: MidiEngineSnapshot = {
      ...baseSnap, activeContext: 'mixer', layers: [{ id: 'ch0', fader: 1 }, { id: 'ch1', fader: 1 }],
      focused: { role: 'mixer', layer: 0, id: 'ch0', entryId: 'e0', key: 'mixer:ch0:e0:m1',
        exports: [{ id: 3, name: 'glow', v0: 0.5 }],
        midiMappings: [{ id: 'm1', enabled: true, control: { type: 'cc', channel: 0, number: 51 }, target: { parameter: 'glow' }, range: [0, 1] }] },
    };
    const bindProfile = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      contexts: { mixer: [{ id: 'noop', match: { type: 'note', channel: 0, notes: [120] }, action: { kind: 'blackoutToggle' } }] },
    });
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [bindProfile], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'mixer',
      // Touch focus: swap the snapshot to layer 1 synchronously (the catch-up).
      onFocusChange: (l) => { if (l === 1) snap = { ...snap, focused: { role: 'mixer', layer: 1, id: 'ch1', entryId: 'e1', key: 'mixer:ch1:e1:m1', exports: [{ id: 4, name: 'glow', v0: 0.5 }], midiMappings: [{ id: 'm1', enabled: true, control: { type: 'cc', channel: 0, number: 51 }, target: { parameter: 'glow' }, range: [0, 1] }] } }; },
    });
    await manager.start();
    manager.setFocusIntent(1); // touch tap → focus ch1; snapshot catches up in the callback
    transport.emit([0xb0, 51, 64]); // ~0.5 ≈ current → picks up → writes to ch1
    expect(api.setMixerChannelControl).toHaveBeenCalledWith('ch1', 4, expect.closeTo(64 / 127, 5));
  });

  it('#2 MidiManager.setFocusIntent fans out to the runtime and fires onFocusChange', async () => {
    const snap: MidiEngineSnapshot = {
      ...baseSnap, activeContext: 'mixer', layers: [{ id: 'ch0', fader: 1 }, { id: 'ch1', fader: 1 }],
      focused: { role: 'mixer', layer: 0, id: 'ch0', entryId: 'e', key: 'mixer:ch0:e:', exports: [], midiMappings: [] },
    };
    const onFocusChange = vi.fn();
    const p = validateProfile({ device: { id: 'apc', label: 'APC', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 }, contexts: { mixer: [{ id: 'noop', match: { type: 'note', channel: 0, notes: [120] }, action: { kind: 'blackoutToggle' } }] } });
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const manager = new MidiManager({ profiles: [p], transportFactory: () => transport, api, getSnapshot: () => snap, defaultContext: 'mixer', onFocusChange });
    await manager.start();
    manager.setFocusIntent(1);
    expect(onFocusChange).toHaveBeenCalledWith(1);
    manager.setFocusIntent(5); // absent layer → inert
    expect(onFocusChange).toHaveBeenCalledTimes(1);
  });

  // ── N3 cross-channel delta: focus change mid-window DROPS the delta ──
  it('N3 drops a focusedParamDelta when focus changed between accumulate and flush', async () => {
    let snap: MidiEngineSnapshot = {
      ...baseSnap, activeContext: 'deck', deckLayer: { id: 'd1', fader: 1 },
      focused: { role: 'deck', layer: 0, id: 'd1', entryId: 'e0', key: 'deck:d1:e0:', exports: [{ id: 5, name: 'glow', v0: 0.5 }], midiMappings: [] },
    };
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const ft = makeFakeTimers();
    const manager = new MidiManager({
      profiles: [mftProfile], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'deck', coalescerTimers: ft.timers,
    });
    await manager.start();
    transport.emit([0xb0, 0, 65]); // accumulate a +0.01 delta under focus key e0
    // Focus changes to a DIFFERENT channel/entry before the window flushes.
    snap = { ...snap, focused: { role: 'deck', layer: 0, id: 'd2', entryId: 'e9', key: 'deck:d2:e9:', exports: [{ id: 7, name: 'glow', v0: 0.5 }], midiMappings: [] } };
    ft.flushDue();
    expect(api.setDeckChannelControl).not.toHaveBeenCalled(); // dropped, not written to d2
    expect(manager.getStatuses()[0].lastEvent).toMatch(/focus changed/);
  });

  // ── #7 reset/turn race: encoder push cancels the same encoder's pending turn ──
  it('#7 an encoder push cancels the same knob\'s pending accumulated turn (no post-reset jump)', async () => {
    const snap: MidiEngineSnapshot = {
      ...baseSnap, activeContext: 'deck', deckLayer: { id: 'd1', fader: 1 },
      focused: { role: 'deck', layer: 0, id: 'd1', entryId: 'e', key: 'deck:d1:e:', exports: [{ id: 5, name: 'glow', v0: 0.5, defaultValue: 0.3 }], midiMappings: [] },
    };
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const ft = makeFakeTimers();
    const manager = new MidiManager({
      profiles: [mftProfile], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'deck', coalescerTimers: ft.timers,
    });
    await manager.start();
    transport.emit([0xb0, 0, 66]); // spin +0.05 → pending in the k0_turn slot
    transport.emit([0xb1, 0, 127]); // push knob 0 → reset to 0.3, cancels the pending turn
    ft.flushDue(); // the reset flushes; the cancelled turn must NOT also flush
    const calls = (api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls;
    // Only the reset write (0.3) — no trailing turn write (which would have been ~0.55).
    expect(calls).toEqual([[5, 0.3]]);
  });

  // ── 8a combineDelta mismatched kinds → THROW (codex: fail loud, no fallback) ──
  it('8a combineDelta throws on mismatched kinds (was a silent `return incoming`)', () => {
    expect(() => combineDelta(
      { kind: 'focusedParamDelta', index: 0, delta: 0.1 },
      { kind: 'paramCenterDelta', key: 'speed', delta: 0.1 },
    )).toThrow(/mismatched kinds/);
  });

  // ── 8b unknown CPC key on the delta path → setStatus error (not silent) ──
  it('8b an unknown global-param key on a delta is a VISIBLE error, not a silent swallow', async () => {
    const globalProfile = validateProfile({
      device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      controls: [{ id: 'g0', match: { type: 'cc', channel: 0, cc: 16, relative: true }, action: { kind: 'paramCenterRelative', key: 'bogus', steps: [0.01, 0.05, 0.1] } }],
    });
    const snap: MidiEngineSnapshot = { ...baseSnap, globalParamValues: { speed: 0.5 } }; // no 'bogus'
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const ft = makeFakeTimers();
    const manager = new MidiManager({
      profiles: [globalProfile], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'deck', coalescerTimers: ft.timers,
    });
    await manager.start();
    transport.emit([0xb0, 16, 65]); ft.flushDue();
    expect(api.updateParamCenter).not.toHaveBeenCalled();
    const s = manager.getStatuses()[0];
    expect(s.kind).toBe('error');
    expect(s.error).toMatch(/unknown global param key 'bogus'/);
  });
});
