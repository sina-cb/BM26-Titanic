// Shared test doubles for the MIDI manager integration/scenario suites.
//
// This is TEST-ONLY support: it is not matched by any vitest test glob and is
// unreachable from the app entry, so Metro never bundles it (unlike the prod
// `fake_demo_transport.ts`). It reconciles the FakeTransport + makeApi copies
// that had been pasted verbatim across six suites — one superset that satisfies
// every caller: source/destination open tracking with fail-loud guards, the
// hotplug `setEndpoints`/`fireEndpointsChanged` helpers, and a timestamped
// `emit`.

import { vi } from 'vitest';

import { MidiTransport, MidiEndpoint, MidiMessageEvent } from '../transport';
import { MidiDispatchApi } from '../dispatch';

/** A synchronous, inspectable MidiTransport for driving MidiManager in tests.
 *  `sent` records every outbound frame; `emit` injects an inbound message. */
export class FakeTransport implements MidiTransport {
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
  emit(data: number[], timestampMs = 0) { for (const cb of this.msgCbs) cb({ sourceId: this.openedSource ?? '', data, timestampMs }); }
  /** Swap the visible endpoints (an unplug = []) and fire the hotplug event,
   *  exactly as Web MIDI does on a physical (re)plug. */
  setEndpoints(eps: MidiEndpoint[]) { this.endpoints = eps; for (const cb of this.epCbs) cb(); }
  /** Fire N `endpointsChanged` events WITHOUT changing the endpoint set — models
   *  Web MIDI emitting one statechange per PORT (input + output) for a single
   *  physical plug, all fanned to this transport's listeners. */
  fireEndpointsChanged(times = 1) { for (let i = 0; i < times; i += 1) for (const cb of this.epCbs) cb(); }
}

/** A MidiDispatchApi whose every method is a vi.fn resolving `{ ok: true }`. */
export function makeApi(): MidiDispatchApi {
  const ok = async () => ({ ok: true });
  return {
    updateParamCenter: vi.fn(ok), updateMixerMaster: vi.fn(ok), setActivePattern: vi.fn(ok),
    setGlobalBlackout: vi.fn(ok), setGlobalEffect: vi.fn(ok), setSectionBrightness: vi.fn(ok),
    setGroupFixedColor: vi.fn(ok), updateMixerChannel: vi.fn(ok), updateDeckChannel: vi.fn(ok),
    dispatchGlobalEffectSlotAction: vi.fn(ok), setGlobalEffectBlackout: vi.fn(ok),
    setChannelPlaylistEntry: vi.fn(ok),
    setGlobalEffectSlotIntensity: vi.fn(ok), resetGlobalEffectSlotIntensity: vi.fn(ok),
    setEffectsPage: vi.fn(ok), cycleGlobalEffectSlotMode: vi.fn(ok), nextEffectBank: vi.fn(ok),
    resetAllGlobalEffects: vi.fn(ok), disableAllGlobalEffects: vi.fn(ok),
    setDeckChannelControl: vi.fn(ok), setMixerChannelControl: vi.fn(ok),
    setChannelHue: vi.fn(ok),
    toggleDeckMixerView: vi.fn(ok), toggleCombinedAutopilot: vi.fn(ok), toggleMasterFade: vi.fn(ok), summonPerformanceDialog: vi.fn(ok),
  };
}
