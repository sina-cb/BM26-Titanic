// Behavior-aware global-effect slot dispatch — the full manager path proof for
// the Iceberg-Flash / White-Drop fix. A TRIGGER slot (a momentary drop-hit)
// must dispatch 'trigger', not the historically-hardcoded 'toggle' (a no-op
// flash-wise on a momentary effect). A TOGGLE slot still dispatches 'toggle',
// and a slot whose behavior hasn't reached the snapshot yet (a boot/refresh
// race) fails SAFE to 'toggle' rather than crashing.
//
// This lives in its own file (not manager.test.ts) as a focused, self-contained
// proof: it exercises the full MidiManager → resolveEvent → dispatcher path for
// the behavior-aware slot fix with its own minimal fixtures.

import { describe, it, expect, vi } from 'vitest';
import { MidiManager, MidiEngineSnapshot } from './manager';
import { MidiTransport, MidiEndpoint, MidiMessageEvent } from './transport';
import { validateProfile } from './profile';
import { MidiDispatchApi } from './dispatch';

const fullEndpoints: MidiEndpoint[] = [
  { id: 'in-0', name: 'APC mini mk2', portIndex: 0, kind: 'source' },
  { id: 'out-0', name: 'APC mini mk2', portIndex: 0, kind: 'destination' },
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
    if (event === 'midiMessage') {
      this.msgCbs.add(cb as (e: MidiMessageEvent) => void);
      return () => this.msgCbs.delete(cb as (e: MidiMessageEvent) => void);
    }
    this.epCbs.add(cb as () => void);
    return () => this.epCbs.delete(cb as () => void);
  }
  close() { this.msgCbs.clear(); this.epCbs.clear(); }

  emit(data: number[], timestampMs = 0) {
    for (const cb of this.msgCbs) cb({ sourceId: this.openedSource ?? '', data, timestampMs });
  }
}

function makeApi(): MidiDispatchApi {
  const ok = async () => ({ ok: true });
  return {
    updateParamCenter: vi.fn(ok), updateMixerMaster: vi.fn(ok), setActivePattern: vi.fn(ok),
    setGlobalBlackout: vi.fn(ok), setGlobalEffect: vi.fn(ok), setSectionBrightness: vi.fn(ok),
    setGroupFixedColor: vi.fn(ok), updateMixerChannel: vi.fn(ok), updateDeckChannel: vi.fn(ok),
    dispatchGlobalEffectSlotAction: vi.fn(ok), setGlobalEffectBlackout: vi.fn(ok),
    setGlobalEffectSlotIntensity: vi.fn(ok), resetGlobalEffectSlotIntensity: vi.fn(ok),
    setEffectsPage: vi.fn(ok), cycleGlobalEffectSlotMode: vi.fn(ok),
    resetAllGlobalEffects: vi.fn(ok), disableAllGlobalEffects: vi.fn(ok),
    setChannelPlaylistEntry: vi.fn(ok),
    setDeckChannelControl: vi.fn(ok), setMixerChannelControl: vi.fn(ok),
    setChannelHue: vi.fn(ok),
    toggleDeckMixerView: vi.fn(ok), toggleCombinedAutopilot: vi.fn(ok), toggleMasterFade: vi.fn(ok),
  };
}

const baseSnap: MidiEngineSnapshot = {
  blackout: false, activePattern: null, patterns: [], globalEffects: {},
  layers: [], deckLayer: null, activeContext: 'mixer', globalEffectSlots: [], colorPalettes: [],
  focused: null, syncOwnedKeys: new Set<string>(),
};

/** A profile whose scene pad (note 117) maps to global-effect slot 2. */
function slotProfile() {
  return validateProfile({
    device: { id: 'apc', label: 'APC mini mk2', nameContains: 'APC mini mk2', sourcePort: 0, destinationPort: 0 },
    contexts: {
      mixer: [
        {
          id: 'ge2',
          match: { type: 'note', channel: 0, notes: [117] },
          action: { kind: 'globalEffectSlot', slot: 2 },
          led: { on: 1, off: 0 },
        },
      ],
    },
  });
}

async function pressSlotPad(slots: MidiEngineSnapshot['globalEffectSlots']) {
  const snap: MidiEngineSnapshot = { ...baseSnap, globalEffectSlots: slots };
  const transport = new FakeTransport(fullEndpoints);
  const api = makeApi();
  const manager = new MidiManager({
    profiles: [slotProfile()], transportFactory: () => transport, api,
    getSnapshot: () => snap, defaultContext: 'mixer',
  });
  await manager.start();
  transport.emit([0x90, 117, 127]); // Note On the scene pad → slot 2
  return api;
}

describe('behavior-aware global-effect slot dispatch (full manager path)', () => {
  it('a TOGGLE slot dispatches toggle', async () => {
    const api = await pressSlotPad([{ slot: 2, active: false, behavior: 'toggle' }]);
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(2, 'toggle');
  });

  it('a TRIGGER slot dispatches trigger (the Iceberg-Flash / White-Drop fix)', async () => {
    const api = await pressSlotPad([{ slot: 2, active: false, behavior: 'trigger' }]);
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(2, 'trigger');
  });

  it('an absent behavior (snapshot race) FAILS SAFE to toggle — no crash', async () => {
    const api = await pressSlotPad([{ slot: 2, active: false }]);
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(2, 'toggle');
  });

  it('a slot missing from the snapshot entirely FAILS SAFE to toggle', async () => {
    const api = await pressSlotPad([{ slot: 1, active: false, behavior: 'toggle' }]); // slot 2 absent
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(2, 'toggle');
  });

  // Regression: Sina's TWO-STEP contract is VSN1-ONLY. A non-VSN1 device (this
  // APC profile) must keep the historical DIRECT behavior — a SINGLE press
  // dispatches immediately, no select-first gate. (The two-step select/commit is
  // proven for the VSN1 in vsn1_intensity.test.ts.)
  it('a NON-VSN1 device dispatches on the FIRST press (no two-step gate)', async () => {
    const api = await pressSlotPad([{ slot: 2, active: false, behavior: 'toggle' }]);
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledTimes(1);
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(2, 'toggle');
  });
});
