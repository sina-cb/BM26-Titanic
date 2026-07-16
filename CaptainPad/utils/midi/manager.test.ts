import { describe, it, expect, vi } from 'vitest';
import { MidiManager, MidiEngineSnapshot, combineDelta } from './manager';
import { MidiEndpoint } from './transport';
import { validateProfile } from './profile';
import { ACCEL_GAIN_MIN, MAX_WINDOW_STEP, TickAccelerator } from './accel';
import { FakeTransport, makeApi } from './test_support/fake_transport';

// MFT relative model (operator-confirmed feel): decodeRelativeDelta returns the
// FULL firmware count (value − 64 — the fast-twist fix; the old six-code map
// dropped everything outside 61-67), resolver.relativeStep is LINEAR
// (count × steps[0]), and accel.ts applies a MODEST per-tick velocity gain on
// top (round-4 asymmetric EMA, GAIN_MAX 3.0). FakeTransport emits every tick
// with the SAME timestamp (0) unless a test passes one explicitly. Same-
// timestamp ticks keep the velocity estimate at rest (zero-gap EMA step is a
// no-op), so every default-emitted tick gets the deterministic PRECISION gain:
// effective delta = count × steps[0] × ACCEL_GAIN_MIN.
const DETENT_STEP = 0.01 * ACCEL_GAIN_MIN; // one +1 detent of the test profiles' steps[0], precision-gained

/** Replicate the runtime's per-tick gaining for a synthetic tick train —
 *  [rawDelta, timestampMs] pairs — to compute a test's expected window sum. */
function gainedSum(ticks: Array<[number, number]>): number {
  const acc = new TickAccelerator();
  return ticks.reduce((s, [d, t]) => s + acc.applyTick(d, t), 0);
}

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

  // The APC pad-window browse contract — scroll advances the window, a window
  // pad selects the entry the UI highlights at that slot, and the window
  // recenters ONLY for a CaptainPad list UI tap (never an engine/autopilot
  // switch) — is proven, in stronger dedicated form, in
  // scenarios/window_sync.test.ts: the "pressing pad slot s selects window[s]"
  // invariant and the "only a UI list tap recenters the browse window" block.
  // (window_slot.test.ts covers the pure windowing functions.)

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
    // CC 52 is unmapped in the profile AND unbound on the focused pattern (CC 51
    // is bound → it would be rejected as a duplicate, P2-2). Move it while armed.
    transport.emit([0xb0, 52, 100]);
    expect(results).toEqual([{ ref: { type: 'cc', channel: 0, number: 52 } }]);
    expect(manager.isLearning()).toBe(false); // auto-disarmed after capture
    // The captured control was swallowed — no dispatch fired while learning.
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
    expect(results).toEqual([{ conflict: { kind: 'profile-claimed', controlId: 'fader_7_speed' } }]);
    expect(manager.isLearning()).toBe(false); // disarmed
    // The profile action did NOT fire while armed (it was swallowed with the conflict).
    expect(api.updateParamCenter).not.toHaveBeenCalledWith({ speed: expect.anything() });
  });

  it('1.1 still captures an unmapped, unbound control (CC 52 is free)', async () => {
    // CC 51 is already bound in `deckFocused` (m1 → sliderGlow), so it is now
    // rejected as a duplicate (P2-2); CC 52 is neither profile-mapped nor bound.
    const { manager, transport } = setupClaiming(deckFocused());
    await manager.start();
    const results: unknown[] = [];
    manager.armLearn((r) => results.push(r));
    transport.emit([0xb0, 52, 100]); // CC 52 unmapped + unbound → captured
    expect(results).toEqual([{ ref: { type: 'cc', channel: 0, number: 52 } }]);
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
    expect(s.error).toMatch(/MIDI sysex denied — reload and allow/);
    expect(s.error).toMatch(/sysex not permitted/); // raw reason still parenthesised
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
    transport.emit([0xb0, 0, 65]); // +1 count → steps[0] × precision gain = 0.005
    ft.flushDue();                  // accumulate flushes on the trailing window
    expect(api.setDeckChannelControl).toHaveBeenCalledWith(5, expect.closeTo(0.5 + DETENT_STEP, 5));
  });

  it('ACCUMULATES deltas within a window (sum, not last-write-wins)', async () => {
    // Anchor at 0. Counts are LINEAR (value − 64 decoding replaced the old
    // clamped [0.01, 0.05, 0.1] triple); same-timestamp ticks all get the
    // precision gain, so codes +1, +2, +3 sum to 6 detent-steps; last-write-
    // wins would only carry 3.
    const { manager, api, transport, ft } = setupMft(() => deckFocus(0));
    await manager.start();
    transport.emit([0xb0, 0, 65]); // +1 count
    transport.emit([0xb0, 0, 66]); // +2 counts
    transport.emit([0xb0, 0, 67]); // +3 counts
    ft.flushDue();
    // ONE write carrying the SUM, not just the last tick.
    expect(api.setDeckChannelControl).toHaveBeenCalledTimes(1);
    const value = (api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls[0][1] as number;
    expect(value).toBeCloseTo(6 * DETENT_STEP, 5);
    expect(value).toBeGreaterThan(3 * DETENT_STEP);
  });

  it('clamps the applied value to [0, 1]', async () => {
    const { manager, api, transport, ft } = setupMft(() => deckFocus(0.98));
    await manager.start();
    transport.emit([0xb0, 0, 81]); // +17 → 0.17 × precision gain = 0.085 → 0.98 + 0.085 → clamped to 1
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

  it('the no-movement code (64) writes nothing (loud silence)', async () => {
    // 64 is the binary-offset centre = zero counts — the ONLY value that
    // resolves to nothing now that the full 0..127 field decodes (fast fix).
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
    expect(api.setDeckChannelControl).toHaveBeenCalledWith(5, expect.closeTo(0.3 + DETENT_STEP, 5));
  });

  it('falls back to v0 when the export carries no base (unmodulated param)', async () => {
    const { manager, api, transport, ft } = setupMft(() => deckFocus(0.5)); // no base
    await manager.start();
    transport.emit([0xb0, 0, 65]); // +0.01 (gained) off v0
    ft.flushDue();
    expect(api.setDeckChannelControl).toHaveBeenCalledWith(5, expect.closeTo(0.5 + DETENT_STEP, 5));
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
    transport.emit([0xb0, 16, 65]); // +0.01 (gained)
    ft.flushDue();
    expect(api.updateParamCenter).toHaveBeenCalledWith({ speed: expect.closeTo(0.5 + DETENT_STEP, 5) });
  });

  it('speed-sync ON gates only speed — a size knob delta still writes', async () => {
    const snap: MidiEngineSnapshot = {
      ...baseSnap, globalParamValues: { speed: 0.5, size: 0.5 },
      bpmSpeedSyncOn: true, syncOwnedKeys: new Set(['speed']),
    };
    const { manager, api, transport, ft } = setupGlobalMft(() => snap);
    await manager.start();
    transport.emit([0xb0, 17, 65]); // +0.01 on size (gained)
    ft.flushDue();
    expect(api.updateParamCenter).toHaveBeenCalledWith({ size: expect.closeTo(0.5 + DETENT_STEP, 5) });
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
    const step = DETENT_STEP; // one +0.01 tick per window, precision-gained
    transport.emit([0xb0, 0, 65]); ft.flushDue(); // window 1: 0.5 + step
    transport.emit([0xb0, 0, 65]); ft.flushDue(); // window 2: 0.5 + 2·step (NOT 0.5 + step)
    transport.emit([0xb0, 0, 65]); ft.flushDue(); // window 3: 0.5 + 3·step
    const calls = (api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1][1]).toBeCloseTo(0.5 + 3 * step, 5);
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
    transport.emit([0xb0, 0, 65]); ft.flushDue(); // 0.5 + step (optimistic holds it)
    v0 = 0.9;                                      // external jump (> epsilon 0.15)
    transport.emit([0xb0, 0, 65]); ft.flushDue(); // re-seed from 0.9 → 0.9 + step
    const calls = (api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1][1]).toBeCloseTo(0.9 + DETENT_STEP, 5);
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
    const step = DETENT_STEP;
    transport.emit([0xb0, 16, 65]); ft.flushDue(); // 0.5 → 0.5 + step
    transport.emit([0xb0, 16, 65]); ft.flushDue(); // → 0.5 + 2·step (NOT 0.5 + step)
    const calls = (api.updateParamCenter as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1][0]).toEqual({ size: expect.closeTo(0.5 + 2 * step, 5) });
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

  // ── 8b unknown CPC key (map LOADED) → VISIBLE but NON-FATAL (P2-1) ──
  // A key missing from a LOADED globalParamValues map is a real config error but
  // must NOT sticky-error (that would freeze projectAndSend + all LEDs). It's
  // aggregated into paramErrors, surfaced in lastEvent, and the controller stays
  // `connected`. (The boot-race case — undefined map — is covered separately.)
  it('8b an unknown global-param key on a LOADED map is a VISIBLE, NON-FATAL error (aggregated, stays connected)', async () => {
    const globalProfile = validateProfile({
      device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      controls: [{ id: 'g0', match: { type: 'cc', channel: 0, cc: 16, relative: true }, action: { kind: 'paramCenterRelative', key: 'bogus', steps: [0.01, 0.05, 0.1] } }],
    });
    const snap: MidiEngineSnapshot = { ...baseSnap, globalParamValues: { speed: 0.5 } }; // LOADED, no 'bogus'
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
    expect(s.kind).toBe('connected'); // NON-FATAL — never sticky-red
    expect(s.lastEvent).toMatch(/bogus \(not in engine schema/);
    expect(s.paramErrors).toContainEqual({ controlId: 'bogus', key: 'bogus' });
  });
});

// ── W1 runtime fixes: dispatch fail-loud, boot-race, reset/turn, learn footguns ─
describe('MidiManager — W1 runtime correctness + fail-loud', () => {
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

  const deckFocus = (v0: number, defaultValue?: number): MidiEngineSnapshot => ({
    ...baseSnap, activeContext: 'deck', deckLayer: { id: 'd1', fader: 1 },
    focused: {
      role: 'deck', layer: 0, id: 'd1', entryId: 'e', key: 'deck:d1:e:',
      exports: [{ id: 5, name: 'glow', v0, defaultValue }], midiMappings: [],
    },
  });

  // ── P2-5: dispatch results are surfaced (was discarded) ──────────────────
  const apcSpeed = validateProfile({
    device: { id: 'apc', label: 'APC', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
    controls: [{ id: 'blk', match: { type: 'note', channel: 0, notes: [50] }, action: { kind: 'blackoutToggle' } }],
  });

  // Drain the microtask + macrotask queue so a `void runDispatch(...)` (which
  // awaits a mocked api promise then setStatus) has fully settled.
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it('P2-5 an ok:false dispatch sets a visible ✕ lastEvent (was silent)', async () => {
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    (api.setGlobalEffectBlackout as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, error: 'engine down' });
    const manager = new MidiManager({
      profiles: [apcSpeed], transportFactory: () => transport, api,
      getSnapshot: () => baseSnap, defaultContext: 'default',
    });
    await manager.start();
    transport.emit([0x90, 50, 127]); // blackout press → dispatch fails
    await flush();
    expect(manager.getStatuses()[0].lastEvent).toMatch(/✕ blackoutToggle failed: engine down/);
  });

  it('P2-5 escalates to a NON-STICKY warning after N consecutive failures, cleared on success', async () => {
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const fail = api.setGlobalEffectBlackout as ReturnType<typeof vi.fn>;
    fail.mockResolvedValue({ ok: false, error: 'engine down' });
    const manager = new MidiManager({
      profiles: [apcSpeed], transportFactory: () => transport, api,
      getSnapshot: () => baseSnap, defaultContext: 'default',
    });
    await manager.start();
    for (let i = 0; i < 3; i++) { transport.emit([0x90, 50, 127]); await flush(); }
    const s = manager.getStatuses()[0];
    expect(s.kind).toBe('connected'); // NON-STICKY — not sticky-red
    expect(s.warning).toMatch(/MIDI writes failed/);
    // A subsequent success clears the warning + streak.
    fail.mockResolvedValue({ ok: true });
    transport.emit([0x90, 50, 127]); await flush();
    expect(manager.getStatuses()[0].warning).toBeUndefined();
  });

  it('a PERFORMANCE_MODE 409 is quiet: soft lastEvent, no fail-streak, no warning', async () => {
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    // Every dispatch of this action is locked by performance mode.
    (api.setGlobalEffectBlackout as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false, error: 'performance mode is active', code: 'PERFORMANCE_MODE',
    });
    const manager = new MidiManager({
      profiles: [apcSpeed], transportFactory: () => transport, api,
      getSnapshot: () => baseSnap, defaultContext: 'default',
    });
    await manager.start();
    // Fire well past the warn threshold — a locked action must NEVER escalate.
    for (let i = 0; i < 5; i++) { transport.emit([0x90, 50, 127]); await flush(); }
    const s = manager.getStatuses()[0];
    expect(s.lastEvent).toMatch(/🔒 blackoutToggle locked \(performance mode\)/);
    expect(s.warning).toBeUndefined();
    expect(s.kind).toBe('connected'); // never sticky-red
  });

  // ── P2-1: boot race (globalParamValues undefined) is inert, not sticky-red ─
  const mftGlobal = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
    controls: [{ id: 'g0', match: { type: 'cc', channel: 0, cc: 16, relative: true }, action: { kind: 'paramCenterRelative', key: 'size', steps: [0.01, 0.05, 0.1] } }],
  });

  it('P2-1 a bank-2 knob during the WS handshake (values not loaded) stays connected + inert', async () => {
    // globalParamValues is UNDEFINED (no sharedParams frame yet). The OLD code
    // flipped a sticky error here → froze every LED for the set. Now: inert, note,
    // stays connected.
    let snap: MidiEngineSnapshot = { ...baseSnap }; // no globalParamValues
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const ft = makeFakeTimers();
    const manager = new MidiManager({
      profiles: [mftGlobal], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'deck', coalescerTimers: ft.timers,
    });
    await manager.start();
    transport.emit([0xb0, 16, 65]); ft.flushDue();
    let s = manager.getStatuses()[0];
    expect(s.kind).toBe('connected'); // NOT sticky-red
    expect(s.lastEvent).toMatch(/param values not loaded yet/);
    expect(s.paramErrors).toBeUndefined();
    // Recovery: once the first sharedParams frame lands, the knob writes normally.
    snap = { ...baseSnap, globalParamValues: { size: 0.5 } };
    transport.emit([0xb0, 16, 65]); ft.flushDue();
    expect(api.updateParamCenter).toHaveBeenCalledWith({ size: expect.closeTo(0.5 + DETENT_STEP, 5) });
  });

  it('P2-1 a missing key on a LOADED map auto-CLEARS once the key appears', async () => {
    let snap: MidiEngineSnapshot = { ...baseSnap, globalParamValues: { speed: 0.5 } }; // no 'size'
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const ft = makeFakeTimers();
    const manager = new MidiManager({
      profiles: [mftGlobal], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'deck', coalescerTimers: ft.timers,
    });
    await manager.start();
    transport.emit([0xb0, 16, 65]); ft.flushDue();
    expect(manager.getStatuses()[0].paramErrors).toContainEqual({ controlId: 'size', key: 'size' });
    // The schema gains 'size' → the aggregated error auto-clears on the next turn.
    snap = { ...baseSnap, globalParamValues: { speed: 0.5, size: 0.5 } };
    transport.emit([0xb0, 16, 65]); ft.flushDue();
    expect(manager.getStatuses()[0].paramErrors).toBeUndefined();
    expect(api.updateParamCenter).toHaveBeenCalledWith({ size: expect.closeTo(0.5 + DETENT_STEP, 5) });
  });

  // ── P2-3: reset seeds the turn anchor so a follow-up turn keeps the reset ──
  const mftKnob = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
    controls: [
      { id: 'k0_turn', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'focusedParamKnob', index: 0, steps: [0.01, 0.05, 0.1] } },
      { id: 'k0_push', match: { type: 'cc', channel: 1, cc: 0 }, action: { kind: 'focusedParamReset', index: 0 } },
    ],
  });

  it('P2-3 a turn right after a reset accumulates from the RESET value, not the stale snapshot base', async () => {
    // Reset default is 0.3. After the push, the engine echo LAGS: the snapshot
    // still reports v0 = 0.35 (a small, within-epsilon echo creep toward 0.3).
    // The seeded optimistic anchor (0.3) must hold, so an immediate +0.01 turn
    // lands at 0.3 + curved step. The OLD code forgot the anchor → the turn
    // re-seeded from the stale 0.35 snapshot → 0.35 + step. (Only the SEED
    // makes the difference.)
    let snap: MidiEngineSnapshot = deckFocus(0.9, 0.3);
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const ft = makeFakeTimers();
    const manager = new MidiManager({
      profiles: [mftKnob], transportFactory: () => transport, api,
      getSnapshot: () => snap, defaultContext: 'deck', coalescerTimers: ft.timers,
    });
    await manager.start();
    transport.emit([0xb1, 0, 127]); ft.flushDue(); // push → reset to 0.3
    snap = deckFocus(0.35, 0.3);                    // echo creeps toward 0.3 (within eps)
    transport.emit([0xb0, 0, 65]); ft.flushDue();   // +0.01 turn off the seeded 0.3
    const calls = (api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]).toEqual([5, 0.3]);
    expect(calls[calls.length - 1][1]).toBeCloseTo(0.3 + DETENT_STEP, 5); // NOT off the stale 0.35
  });

  // ── P1-3: learn rejects a relative-code CC / a config-device rotary channel ─
  const mftLearnDevice = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0, configureOnConnect: true },
    controls: [{ id: 'noop', match: { type: 'note', channel: 5, notes: [10] }, action: { kind: 'blackoutToggle' } }],
  });

  it('P1-3 learn REJECTS an endless-encoder CC (value decodes as a relative delta)', async () => {
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [mftLearnDevice], transportFactory: () => transport, api,
      getSnapshot: () => deckFocus(0.5), defaultContext: 'default',
    });
    await manager.start();
    const results: unknown[] = [];
    manager.armLearn((r) => results.push(r));
    transport.emit([0xb0, 20, 65]); // ch0 CC 20 value 65 = +1 relative delta code
    // CC 20 ≥ 16 on a configureOnConnect device → a banks-2-4 encoder: the
    // STRUCTURED reason is 'reserved-bank' (the future custom-mapping UI
    // relaxes only that branch).
    expect(results).toEqual([{ conflict: { kind: 'reserved-bank' } }]);
    expect(manager.isLearning()).toBe(false);
  });

  it('P1-3 learn REJECTS a bank-1 endless encoder as order-mapped (relative code, CC < 16)', async () => {
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [mftLearnDevice], transportFactory: () => transport, api,
      getSnapshot: () => deckFocus(0.5), defaultContext: 'default',
    });
    await manager.start();
    const results: unknown[] = [];
    manager.armLearn((r) => results.push(r));
    transport.emit([0xb0, 5, 65]); // ch0 CC 5 = a bank-1 encoder turn (relative +1)
    expect(results).toEqual([{ conflict: { kind: 'order-mapped-encoder' } }]);
    expect(manager.isLearning()).toBe(false);
  });

  it('P1-3 learn REJECTS a CC-hold push on a configureOnConnect device switch channel', async () => {
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [mftLearnDevice], transportFactory: () => transport, api,
      getSnapshot: () => deckFocus(0.5), defaultContext: 'default',
    });
    await manager.start();
    const results: unknown[] = [];
    manager.armLearn((r) => results.push(r));
    transport.emit([0xb1, 32, 127]); // ch1 (SWITCH_AND_COLOR) push, absolute value 127
    expect(results).toEqual([{ conflict: { kind: 'reserved-bank' } }]); // CC 32 = a bank-3 push
    expect(manager.isLearning()).toBe(false);
  });

  // ── P2-2: learn rejects a SECOND binding on a control already bound ─────────
  it('P2-2 learn REJECTS a control the focused pattern already has an enabled binding on', async () => {
    const bound: MidiEngineSnapshot = {
      ...baseSnap, activeContext: 'deck', deckLayer: { id: 'd1', fader: 1 },
      focused: {
        role: 'deck', layer: 0, id: 'd1', entryId: 'e', key: 'deck:d1:e:m1',
        exports: [{ id: 5, name: 'glow', v0: 0.5 }],
        midiMappings: [{ id: 'm1', enabled: true, control: { type: 'cc', channel: 0, number: 51 }, target: { parameter: 'glow' }, range: [0, 1] }],
      },
    };
    const apcNoClaim = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      controls: [{ id: 'noop', match: { type: 'note', channel: 9, notes: [10] }, action: { kind: 'blackoutToggle' } }],
    });
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const manager = new MidiManager({
      profiles: [apcNoClaim], transportFactory: () => transport, api,
      getSnapshot: () => bound, defaultContext: 'default',
    });
    await manager.start();
    const results: unknown[] = [];
    manager.armLearn((r) => results.push(r));
    transport.emit([0xb0, 51, 100]); // CC 51 already bound to 'glow' → rejected
    expect(results).toEqual([{ conflict: { kind: 'already-bound', parameter: 'glow' } }]);
    expect(manager.isLearning()).toBe(false);
  });

  // ── P3-3: a learned write is clamped to [0, 1] (binding.range may exceed it) ─
  it('P3-3 clamps a learned write whose binding.range exceeds the unit interval', async () => {
    const wideBound: MidiEngineSnapshot = {
      ...baseSnap, activeContext: 'deck', deckLayer: { id: 'd1', fader: 1 },
      focused: {
        role: 'deck', layer: 0, id: 'd1', entryId: 'e', key: 'deck:d1:e:m1',
        exports: [{ id: 5, name: 'glow', v0: 0 }],
        // range [0, 4] (engine allows ±4); a full fader would scale to 4 unclamped.
        midiMappings: [{ id: 'm1', enabled: true, control: { type: 'cc', channel: 0, number: 51 }, target: { parameter: 'glow' }, range: [0, 4] }],
      },
    };
    const apcNoClaim = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      controls: [{ id: 'noop', match: { type: 'note', channel: 9, notes: [10] }, action: { kind: 'blackoutToggle' } }],
    });
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const ft = makeFakeTimers();
    const manager = new MidiManager({
      profiles: [apcNoClaim], transportFactory: () => transport, api,
      getSnapshot: () => wideBound, defaultContext: 'default', coalescerTimers: ft.timers,
    });
    await manager.start();
    transport.emit([0xb0, 51, 0]); ft.flushDue();   // 0 → within eps of v0 0 → pickup unlocks, writes 0
    transport.emit([0xb0, 51, 127]); ft.flushDue(); // full → scales to 4 → CLAMPED to 1
    const calls = (api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1]).toEqual([5, 1]); // clamped, not 4
  });

  // ── LED-send failure is surfaced (non-sticky) instead of silently swallowed ─
  it('LED-send failures escalate to a NON-STICKY warning (dead strip not silent)', async () => {
    // A transport whose send() always throws → every LED repaint fails.
    class DeadLedTransport extends FakeTransport {
      send() { throw new Error('LED endpoint gone'); }
    }
    const transport = new DeadLedTransport(mftEndpoints);
    const api = makeApi();
    // An 8-pad bank → the connect repaint tries 8 LED sends at once; all throw,
    // so the FAILED-MESSAGE count crosses the threshold on the first repaint
    // (per-message, not per-call — diffing means later repaints send nothing).
    const p = validateProfile({
      device: { id: 'apc', label: 'APC', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
      controls: [{ id: 'pads', match: { type: 'note', channel: 0, notes: [0, 7] }, action: { kind: 'patternBank', bank: 0 }, led: { active: 21, idle: 1, channel: 6 } }],
    });
    const manager = new MidiManager({
      profiles: [p], transportFactory: () => transport, api,
      getSnapshot: () => ({ ...baseSnap, activePattern: 'p0', patterns: ['p0', 'p1'] }), defaultContext: 'default',
    });
    await manager.start(); // connect repaint tries 8 LED sends, all fail
    const s = manager.getStatuses()[0];
    expect(s.kind).toBe('connected'); // NON-STICKY — the controller keeps running
    expect(s.warning).toMatch(/LED feedback failing/);
  });
});

// ── MFT UX v2: row-0 globals (sync toggle, hue knob), acceleration, LED resync ─
describe('MidiManager — MFT UX v2 (row-0 globals + acceleration + LED resync)', () => {
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

  // The v2 row-0 layout in miniature: speed knob (0,0) with sync-toggle push,
  // hue knob (0,1) with reset push, and the first local knob on encoder 4
  // driving focused.exports[0] (the row-1 offset).
  const v2Profile = validateProfile({
    device: { id: 'mft', label: 'MFT', nameContains: 'Midi Fighter Twister', sourcePort: 0, destinationPort: 0 },
    controls: [
      { id: 'g_speed_turn', match: { type: 'cc', channel: 0, cc: 0, relative: true }, action: { kind: 'paramCenterRelative', key: 'speed', steps: [0.01, 0.05, 0.1] }, led: { on: 50, off: 80 } },
      { id: 'g_speed_push', match: { type: 'cc', channel: 1, cc: 0 }, action: { kind: 'bpmSyncToggle' } },
      { id: 'g_hue_turn', match: { type: 'cc', channel: 0, cc: 1, relative: true }, action: { kind: 'hueKnob', steps: [0.01, 0.05, 0.1] }, led: { off: 80 } },
      { id: 'g_hue_push', match: { type: 'cc', channel: 1, cc: 1 }, action: { kind: 'hueReset' } },
      { id: 'k4_turn', match: { type: 'cc', channel: 0, cc: 4, relative: true }, action: { kind: 'focusedParamKnob', index: 0, steps: [0.01, 0.05, 0.1] } },
      { id: 'k4_push', match: { type: 'cc', channel: 1, cc: 4 }, action: { kind: 'focusedParamReset', index: 0 } },
    ],
  });

  function setupV2(getSnap: () => MidiEngineSnapshot) {
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const ft = makeFakeTimers();
    const manager = new MidiManager({
      profiles: [v2Profile], transportFactory: () => transport, api,
      getSnapshot: getSnap, defaultContext: 'deck', coalescerTimers: ft.timers,
    });
    return { transport, api, manager, ft };
  }

  const deckSnap = (
    over: Partial<MidiEngineSnapshot> = {},
    focusedOver: Partial<NonNullable<MidiEngineSnapshot['focused']>> = {},
  ): MidiEngineSnapshot => ({
    ...baseSnap,
    activeContext: 'deck',
    deckLayer: { id: 'd1', fader: 1 },
    focused: {
      role: 'deck', layer: 0, id: 'd1', entryId: 'e', key: 'deck:d1:e:',
      exports: [{ id: 5, name: 'glow', v0: 0.2 }], midiMappings: [], hue: 10,
      ...focusedOver,
    },
    globalParamValues: { speed: 0.5 },
    ...over,
  });

  // ── (0,0) push: BPM→Speed sync toggle ──
  it('speed-knob push toggles bpmSpeedSync ON via updateParamCenter', async () => {
    const { manager, api, transport } = setupV2(() => deckSnap({ bpmSpeedSyncOn: false }));
    await manager.start();
    transport.emit([0xb1, 0, 127]); // push (0,0)
    expect(api.updateParamCenter).toHaveBeenCalledWith({ bpmSpeedSync: 1 });
  });

  it('speed-knob push toggles bpmSpeedSync OFF when the snapshot says ON', async () => {
    const { manager, api, transport } = setupV2(() => deckSnap({ bpmSpeedSyncOn: true, syncOwnedKeys: new Set(['speed']) }));
    await manager.start();
    transport.emit([0xb1, 0, 127]);
    expect(api.updateParamCenter).toHaveBeenCalledWith({ bpmSpeedSync: 0 });
  });

  it('speed-knob push RELEASE (value 0) is swallowed', async () => {
    const { manager, api, transport } = setupV2(() => deckSnap());
    await manager.start();
    transport.emit([0xb1, 0, 0]); // CC-hold release
    expect(api.updateParamCenter).not.toHaveBeenCalled();
  });

  // ── (0,0) LED: solid GREEN while sync owns speed, RED otherwise ──
  it('paints the speed knob GREEN (led.on) while sync is ON, RED (led.off) when OFF', async () => {
    let snap = deckSnap({ bpmSpeedSyncOn: false, syncOwnedKeys: new Set<string>() });
    const { manager, transport } = setupV2(() => snap);
    await manager.start();
    expect(transport.sent).toContainEqual([0xb1, 0, 80]); // rest = RED
    // No strobe cue any more — the animation channel is pinned to NONE.
    expect(transport.sent).toContainEqual([0xb2, 0, 0]);
    transport.sent.length = 0;
    snap = deckSnap({ bpmSpeedSyncOn: true, syncOwnedKeys: new Set(['speed']) });
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0xb1, 0, 50]); // sync ON = solid GREEN
    expect(transport.sent).not.toContainEqual([0xb2, 0, 4]); // NOT the old strobe
  });

  // ── (0,0) turn: existing paramCenterDelta machinery + sync gate kept ──
  it('speed knob writes via paramCenter and stays INERT while sync owns speed', async () => {
    let snap = deckSnap({ syncOwnedKeys: new Set<string>() });
    const { manager, api, transport, ft } = setupV2(() => snap);
    await manager.start();
    transport.emit([0xb0, 0, 65]); ft.flushDue(); // +0.01 (gained)
    expect(api.updateParamCenter).toHaveBeenCalledWith({ speed: expect.closeTo(0.5 + DETENT_STEP, 5) });
    snap = deckSnap({ bpmSpeedSyncOn: true, syncOwnedKeys: new Set(['speed']) });
    (api.updateParamCenter as ReturnType<typeof vi.fn>).mockClear();
    transport.emit([0xb0, 0, 65]); ft.flushDue();
    expect(api.updateParamCenter).not.toHaveBeenCalled(); // gate kept (I4)
  });

  // ── (0,1) hue knob — DECK context: the DECK CHANNEL's per-channel hue ──
  // Sina's ruling (2026-07): the global hue shifter was removed. The hue knob
  // targets the FOCUSED CHANNEL's per-channel hue in BOTH contexts — on the
  // deck tab that focused channel IS the deck channel (auto-focused, role
  // 'deck'), written through setChannelHue(..., { deck: true }). No autoRotate
  // field exists per channel, so none is ever sent.
  it('deck-context hue turn accumulates degrees onto the DECK CHANNEL (gained ring fraction × 360)', async () => {
    const { manager, api, transport, ft } = setupV2(() => deckSnap());
    await manager.start();
    transport.emit([0xb0, 1, 65]); // +1 tick → 0.01 of the ring, gained, × 360°
    ft.flushDue();
    expect(api.setChannelHue).toHaveBeenCalledWith(
      'd1', expect.closeTo(10 + DETENT_STEP * 360, 5), { deck: true },
    );
  });

  it('deck-context hue CLAMPS at the top stop (no wrap-around — Sina 2026-07-10)', async () => {
    // The hue knob behaves like every other param: hard stops at both ends,
    // never rotating past. The top stop is held a hair under 360 so the
    // engine's wheel-wrap can't fold it back to 0.
    const { manager, api, transport, ft } = setupV2(() => deckSnap({}, { hue: 359 }));
    await manager.start();
    transport.emit([0xb0, 1, 65]); // 359° + 1.8° → clamps at the top stop
    ft.flushDue();
    expect(api.setChannelHue).toHaveBeenCalledWith(
      'd1', expect.closeTo(359.99, 1), { deck: true },
    );
  });

  it('deck-context hue knob is INERT (visible note) while the deck channel hue has not loaded', async () => {
    const { manager, api, transport, ft } = setupV2(() => deckSnap({}, { hue: undefined }));
    await manager.start();
    transport.emit([0xb0, 1, 65]); ft.flushDue();
    expect(api.setChannelHue).not.toHaveBeenCalled();
    expect(manager.getStatuses()[0].lastEvent).toMatch(/channel hue not loaded/);
  });

  it('deck-context hue push resets the DECK CHANNEL to 0° and CANCELS a pending hue turn', async () => {
    const { manager, api, transport, ft } = setupV2(() => deckSnap());
    await manager.start();
    transport.emit([0xb0, 1, 66]); // pending +0.05-of-ring turn
    transport.emit([0xb1, 1, 127]); // push → reset
    ft.flushDue(); // the cancelled turn must NOT also flush
    const calls = (api.setChannelHue as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toEqual([['d1', 0, { deck: true }]]); // one write: deck channel to 0°
  });

  it('deck-context hue turn with NO focused channel is inert with a visible note', async () => {
    const { manager, api, transport, ft } = setupV2(() => deckSnap({ focused: null }));
    await manager.start();
    transport.emit([0xb0, 1, 65]); ft.flushDue();
    expect(api.setChannelHue).not.toHaveBeenCalled();
    expect(manager.getStatuses()[0].lastEvent).toMatch(/no focused channel/);
  });

  // ── (0,1) hue knob — MIXER context: the FOCUSED CHANNEL's hue ──
  // Sina's spec: "in the mixer, the hue shift midi must change and sync to the
  // FOCUSED CHANNEL's hue shift". The same profile control is context-routed
  // by the runtime — deck targets the deck channel (above), mixer targets the
  // focused overlay; both go through setChannelHue (never a global shifter).
  function setupV2Mixer(getSnap: () => MidiEngineSnapshot) {
    const transport = new FakeTransport(mftEndpoints);
    const api = makeApi();
    const ft = makeFakeTimers();
    const manager = new MidiManager({
      profiles: [v2Profile], transportFactory: () => transport, api,
      getSnapshot: getSnap, defaultContext: 'mixer', coalescerTimers: ft.timers,
    });
    return { transport, api, manager, ft };
  }

  const mixerSnap = (
    over: Partial<MidiEngineSnapshot> = {},
    focusedOver: Partial<NonNullable<MidiEngineSnapshot['focused']>> = {},
  ): MidiEngineSnapshot => ({
    ...baseSnap,
    activeContext: 'mixer',
    layers: [{ id: 'ch_a', fader: 1 }, { id: 'ch_b', fader: 1 }],
    focused: {
      role: 'mixer', layer: 0, id: 'ch_a', entryId: 'e', key: 'mixer:ch_a:e:',
      exports: [{ id: 5, name: 'glow', v0: 0.2 }], midiMappings: [], hue: 100,
      ...focusedOver,
    },
    globalParamValues: { speed: 0.5 },
    ...over,
  });

  it('mixer-context hue turn writes the FOCUSED channel hue (anchored on its value), never the global', async () => {
    const { manager, api, transport, ft } = setupV2Mixer(() => mixerSnap());
    await manager.start();
    transport.emit([0xb0, 1, 65]); // +1 tick → 0.01 of the ring, gained, × 360°
    ft.flushDue();
    expect(api.setChannelHue).toHaveBeenCalledWith(
      'ch_a', expect.closeTo(100 + DETENT_STEP * 360, 5), undefined,
    );
  });

  it('mixer-context per-channel hue CLAMPS at the top stop (no wrap-around)', async () => {
    const { manager, api, transport, ft } = setupV2Mixer(() => mixerSnap({}, { hue: 359 }));
    await manager.start();
    transport.emit([0xb0, 1, 65]);
    ft.flushDue();
    expect(api.setChannelHue).toHaveBeenCalledWith(
      'ch_a', expect.closeTo(359.99, 1), undefined,
    );
  });

  it('mixer-context hue push resets the FOCUSED channel to 0° and CANCELS a pending turn', async () => {
    const { manager, api, transport, ft } = setupV2Mixer(() => mixerSnap());
    await manager.start();
    transport.emit([0xb0, 1, 66]);  // pending turn on ch_a
    transport.emit([0xb1, 1, 127]); // push → per-channel reset
    ft.flushDue(); // the cancelled turn must NOT also flush
    const calls = (api.setChannelHue as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toEqual([['ch_a', 0, undefined]]); // one write: this channel to 0°
  });

  it('mixer-context hue turn with NO focused channel is inert with a visible note', async () => {
    const { manager, api, transport, ft } = setupV2Mixer(() => mixerSnap({ focused: null }));
    await manager.start();
    transport.emit([0xb0, 1, 65]); ft.flushDue();
    expect(api.setChannelHue).not.toHaveBeenCalled();
    expect(manager.getStatuses()[0].lastEvent).toMatch(/no focused channel/);
  });

  it('mixer-context hue turn is INERT (visible note) while the channel hue is not threaded', async () => {
    const { manager, api, transport, ft } = setupV2Mixer(() => mixerSnap({}, { hue: undefined }));
    await manager.start();
    transport.emit([0xb0, 1, 65]); ft.flushDue();
    expect(api.setChannelHue).not.toHaveBeenCalled();
    expect(manager.getStatuses()[0].lastEvent).toMatch(/channel hue not loaded/);
  });

  it('a focus switch MID-WINDOW drops the accumulated per-channel hue delta (never recolors the new channel)', async () => {
    let snap = mixerSnap();
    const { manager, api, transport, ft } = setupV2Mixer(() => snap);
    await manager.start();
    transport.emit([0xb0, 1, 65]); // accumulate against ch_a
    // Focus swaps to ch_b before the window flushes.
    snap = mixerSnap({}, { layer: 1, id: 'ch_b', key: 'mixer:ch_b:e:', hue: 200 });
    ft.flushDue();
    expect(api.setChannelHue).not.toHaveBeenCalled();
    expect(manager.getStatuses()[0].lastEvent).toMatch(/dropped/);
  });

  it('a focus switch re-syncs the hue ring + colour to the NEW channel\'s hue', async () => {
    let snap = mixerSnap({}, { hue: 0 }); // ch_a at 0° → ring 0, red
    const { manager, transport } = setupV2Mixer(() => snap);
    await manager.start();
    expect(transport.sent).toContainEqual([0xb0, 1, 0]);  // ring empty
    expect(transport.sent).toContainEqual([0xb1, 1, 80]); // red (0°)
    transport.sent.length = 0;
    // Focus moves to ch_b (hue 120°) — the repaint must adopt ITS hue.
    snap = mixerSnap({}, { layer: 1, id: 'ch_b', key: 'mixer:ch_b:e:', hue: 120 });
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0xb0, 1, Math.round((120 / 360) * 127)]); // ring third
    expect(transport.sent).toContainEqual([0xb1, 1, 50]); // 120° = green
  });

  it('the hue ring/colour paint from the FOCUSED CHANNEL hue in BOTH contexts (deck channel on deck, overlay on mixer)', async () => {
    // Hue is per-channel only now — the deck knob tracks the DECK CHANNEL's
    // hue, the mixer knob tracks the focused overlay's. Different channels →
    // different paint, driven purely by each context's focused channel hue.
    const deck = setupV2(() => deckSnap({}, { hue: 240 }));
    await deck.manager.start();
    expect(deck.transport.sent).toContainEqual([0xb1, 1, 1]); // deck channel 240° = blue
    const mixer = setupV2Mixer(() => mixerSnap({}, { hue: 120 }));
    await mixer.manager.start();
    expect(mixer.transport.sent).toContainEqual([0xb1, 1, 50]); // focused overlay 120° = green
  });

  // ── velocity model (operator-confirmed feel): the firmware sends the full
  // count (value − 64, decoded 1:1), resolver.relativeStep is LINEAR
  // (count × steps[0]), and accel.ts applies a MODEST per-tick gain on top
  // (round-4 asymmetric EMA, GAIN_MAX 3.0). Slow (one tick per window, same
  // timestamp) sits at precision gain; a timed fast burst accelerates. ──
  it('a slow turn (one tick per window) is ATTENUATED below its raw step (sub-detent precision)', async () => {
    const { manager, api, transport, ft } = setupV2(() => deckSnap());
    await manager.start();
    transport.emit([0xb0, 4, 65]); // one +1 tick → 0.01 raw, precision-gained
    ft.flushDue();
    const value = (api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls[0][1] as number;
    expect(value).toBeCloseTo(0.2 + DETENT_STEP, 5);
    expect(value).toBeLessThan(0.21);     // finer than the raw +0.01 step
    expect(value).toBeGreaterThan(0.2);   // but still moves
  });

  it('a fast burst (real +17 codes at close timestamps) is CAPPED at MAX_WINDOW_STEP per window', async () => {
    const { manager, api, transport, ft } = setupV2(() => deckSnap());
    await manager.start();
    // Ground truth (live capture): a hard spin is a stream of value 81 = +17
    // (the firmware multiplier's ceiling) every ~2-10 ms — a raw window sum of
    // 0.68+ before gain. THE shared speed ceiling (Sina 2026-07-10: every
    // relative knob has the SAME behavior) caps each flush window at
    // MAX_WINDOW_STEP, so a flat-out spin sweeps the full range in ~0.65 s of
    // continuous windows instead of one instant leap.
    for (let i = 0; i < 4; i += 1) transport.emit([0xb0, 4, 81], i * 5);
    ft.flushDue();
    const value = (api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls[0][1] as number;
    const raw = gainedSum([[0.17, 0], [0.17, 5], [0.17, 10], [0.17, 15]]);
    expect(raw).toBeGreaterThan(MAX_WINDOW_STEP); // the burst would exceed the cap…
    expect(value).toBeCloseTo(0.2 + MAX_WINDOW_STEP, 5); // …so the window lands exactly ON it
  });

  it('a fast CCW burst accelerates in the NEGATIVE direction (sign preserved)', async () => {
    const { manager, api, transport, ft } = setupV2(() => deckSnap({
      focused: {
        role: 'deck', layer: 0, id: 'd1', entryId: 'e', key: 'deck:d1:e:',
        exports: [{ id: 5, name: 'glow', v0: 0.9 }], midiMappings: [],
      },
    }));
    await manager.start();
    // Value 47 = −17, the capture's CCW saturation code. Same shared window
    // cap as the CW burst, sign preserved: the window lands exactly at
    // −MAX_WINDOW_STEP below the anchor.
    for (let i = 0; i < 4; i += 1) transport.emit([0xb0, 4, 47], i * 5);
    ft.flushDue();
    const value = (api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls[0][1] as number;
    expect(value).toBeCloseTo(0.9 - MAX_WINDOW_STEP, 5);
    expect(value).toBeGreaterThanOrEqual(0);
  });

  it('the SAME tick train lands on the SAME final value however the windows split (phase independence)', async () => {
    // Three +1 ticks 100 ms apart. Run A flushes after every tick (three
    // windows); run B accumulates all three into one window. The per-tick gain
    // comes from the timestamps alone, so both runs must land exactly on the
    // same final value — bucketing cannot distort the feel.
    const ticks: Array<[number, number]> = [[0.01, 0], [0.01, 100], [0.01, 200]];
    const expected = 0.2 + gainedSum(ticks);

    const a = setupV2(() => deckSnap());
    await a.manager.start();
    for (const [, ts] of ticks) { a.transport.emit([0xb0, 4, 65], ts); a.ft.flushDue(); }
    const aCalls = (a.api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls;
    expect(aCalls[aCalls.length - 1][1]).toBeCloseTo(expected, 9);

    const b = setupV2(() => deckSnap());
    await b.manager.start();
    for (const [, ts] of ticks) b.transport.emit([0xb0, 4, 65], ts);
    b.ft.flushDue();
    const bCalls = (b.api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls;
    expect(bCalls[bCalls.length - 1][1]).toBeCloseTo(expected, 9);
  });

  it('a direction reversal is CLEAN: out-and-back returns exactly to the start value', async () => {
    const { manager, api, transport, ft } = setupV2(() => deckSnap());
    await manager.start();
    transport.emit([0xb0, 4, 65], 0); ft.flushDue();   // +1 (precision gain)
    transport.emit([0xb0, 4, 63], 30); ft.flushDue();  // −1 — reversal resets to precision gain
    const calls = (api.setDeckChannelControl as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1][1]).toBeCloseTo(0.2, 9); // no eaten or doubled ticks
  });

  // ── row-1 offset: encoder 4 drives focused.exports[0]; push-reset remaps too ──
  it('encoder 4 (row 1 col 0) drives ordered export 0 and its push resets it', async () => {
    const snap = deckSnap({
      focused: {
        role: 'deck', layer: 0, id: 'd1', entryId: 'e', key: 'deck:d1:e:',
        exports: [{ id: 5, name: 'glow', v0: 0.2, defaultValue: 0.7 }], midiMappings: [],
      },
    });
    const { manager, api, transport, ft } = setupV2(() => snap);
    await manager.start();
    transport.emit([0xb0, 4, 65]); ft.flushDue(); // turn → exports[0]
    expect(api.setDeckChannelControl).toHaveBeenCalledWith(5, expect.closeTo(0.2 + DETENT_STEP, 5));
    transport.emit([0xb1, 4, 127]); // push → reset exports[0] to its default
    expect(api.setDeckChannelControl).toHaveBeenLastCalledWith(5, 0.7);
  });

  // ── LED re-sync regression: pattern switch repaints the NEW ring values ──
  it('REGRESSION: a pattern switch (new exports) repaints the ring to the new value', async () => {
    let snap = deckSnap(); // glow v0 = 0.2 → ring 25 on encoder 4
    const { manager, transport } = setupV2(() => snap);
    await manager.start();
    expect(transport.sent).toContainEqual([0xb0, 4, Math.round(0.2 * 127)]);
    transport.sent.length = 0;
    // Pattern switch: the snapshot rebuild delivers the NEW pattern's exports
    // (fresh playlist data — the hook busts the fetchPlaylist cache on the
    // engine's `pattern` broadcast) and nudges the manager.
    snap = deckSnap({
      focused: {
        role: 'deck', layer: 0, id: 'd1', entryId: 'e2', key: 'deck:d1:e2:',
        exports: [{ id: 9, name: 'other', v0: 0.9 }], midiMappings: [],
      },
    });
    manager.onEngineUpdate();
    expect(transport.sent).toContainEqual([0xb0, 4, Math.round(0.9 * 127)]); // NEW value, promptly
  });

  // ── LED re-sync: a bank switch forces a FULL repaint (no stale diff base) ──
  it('a bank change repaints ALL mapped LEDs from an empty diff base', async () => {
    const { manager, transport } = setupV2(() => deckSnap());
    await manager.start();
    const ringMsg = [0xb0, 4, Math.round(0.2 * 127)];
    expect(transport.sent).toContainEqual(ringMsg);
    transport.sent.length = 0;
    manager.onEngineUpdate();
    expect(transport.sent).not.toContainEqual(ringMsg); // unchanged → diff sends nothing
    transport.emit([0xb3, 1, 127]); // hardware bank switch (bank 2)
    expect(transport.sent).toContainEqual(ringMsg); // full repaint re-sends reality
  });

  // ── optimistic ring feedback: the ring tracks the KNOB during a sweep (the
  // runtime's just-written optimistic value), and falls back to the snapshot
  // the moment the optimistic entry goes stale (echo landed / external jump /
  // focus switch) — never a frozen stale ring. ──
  describe('optimistic ring feedback', () => {
    // One +3 code (value 67) at rest gets the precision gain (same-timestamp
    // ticks keep the rate estimate at rest): 3 × steps[0] × GAIN_MIN = 0.015 —
    // the optimistic value one flush writes off the deckSnap anchors.
    const GAINED = 3 * DETENT_STEP;
    const ring = (enc: number, v: number) => [0xb0, enc, Math.round(v * 127)];

    it('ring reflects the optimistic export value immediately after a knob flush while the snapshot echo lags', async () => {
      const { manager, transport, ft } = setupV2(() => deckSnap()); // glow v0 = 0.2, frozen (echo in flight)
      await manager.start();
      transport.sent.length = 0;
      transport.emit([0xb0, 4, 67]); // +3 counts → 0.015
      ft.flushDue();
      // The flush itself repaints: ring = the optimistic 0.2 + GAINED, sent
      // WITHOUT any engine update (the snapshot still reads 0.2).
      expect(transport.sent).toContainEqual(ring(4, 0.2 + GAINED));
      // A repaint nudged by unrelated engine state keeps showing the optimistic
      // value (echo still lagging) — no regress-then-catch-up wiggle.
      transport.sent.length = 0;
      manager.onEngineUpdate();
      expect(transport.sent).not.toContainEqual(ring(4, 0.2));
    });

    it('the speed knob ring reflects the optimistic CPC value immediately after a flush', async () => {
      const { manager, transport, ft } = setupV2(() => deckSnap()); // speed = 0.5, frozen
      await manager.start();
      transport.sent.length = 0;
      transport.emit([0xb0, 0, 67]);
      ft.flushDue();
      expect(transport.sent).toContainEqual(ring(0, 0.5 + GAINED));
    });

    it('after an external snapshot jump with the knob idle, the ring follows the snapshot and FORGETS the stale optimistic value', async () => {
      const glowAt = (v0: number) => deckSnap({
        focused: { ...deckSnap().focused!, exports: [{ id: 5, name: 'glow', v0 }] },
      });
      let snap = glowAt(0.2);
      const { manager, transport, ft } = setupV2(() => snap);
      await manager.start();
      transport.emit([0xb0, 4, 67]); ft.flushDue(); // optimistic 0.2 + GAINED, anchor 0.2
      transport.sent.length = 0;
      // Another surface jumps glow to 0.9 — far outside the [0.2, 0.215] echo
      // span. The ring must adopt the snapshot, not freeze on the optimistic.
      snap = glowAt(0.9);
      manager.onEngineUpdate();
      expect(transport.sent).toContainEqual(ring(4, 0.9));
      // The entry was FORGOTTEN: a later external move back to WITHIN the
      // reseed epsilon of the old anchor (0.3 vs 0.2) would read as "echo
      // creep" if the stale entry survived — the ring must show 0.3, not the
      // resurrected optimistic 0.25.
      transport.sent.length = 0;
      snap = glowAt(0.3);
      manager.onEngineUpdate();
      expect(transport.sent).toContainEqual(ring(4, 0.3));
      expect(transport.sent).not.toContainEqual(ring(4, 0.2 + GAINED));
    });

    it('once the echo LANDS the entry is released — a small later external move is followed, not frozen', async () => {
      const glowAt = (v0: number) => deckSnap({
        focused: { ...deckSnap().focused!, exports: [{ id: 5, name: 'glow', v0 }] },
      });
      let snap = glowAt(0.2);
      const { manager, transport, ft } = setupV2(() => snap);
      await manager.start();
      transport.emit([0xb0, 4, 67]); ft.flushDue(); // optimistic 0.2 + GAINED
      // The engine echo lands exactly on our write → settle, entry forgotten.
      snap = glowAt(0.2 + GAINED);
      manager.onEngineUpdate();
      transport.sent.length = 0;
      // A small external move, still within the reseed epsilon of the old
      // anchor — the exact case a lingering stale optimistic would mask.
      snap = glowAt(0.2 + GAINED + 0.1);
      manager.onEngineUpdate();
      expect(transport.sent).toContainEqual(ring(4, 0.2 + GAINED + 0.1));
      expect(transport.sent).not.toContainEqual(ring(4, 0.2 + GAINED));
    });

    it('a focus/entry switch never shows the previous focus\'s optimistic export value (focus-key guard)', async () => {
      let snap = deckSnap(); // entry e, glow 0.2
      const { manager, transport, ft } = setupV2(() => snap);
      await manager.start();
      transport.emit([0xb0, 4, 67]); ft.flushDue(); // optimistic 0.2 + GAINED under key deck:d1:e:
      transport.sent.length = 0;
      // Entry switch: the same knob index now backs a DIFFERENT param whose
      // value (0.22) sits INSIDE the old echo span — only the focus-key guard
      // (not the jump classifier) keeps the stale overlay off the new ring.
      snap = deckSnap({
        focused: {
          role: 'deck', layer: 0, id: 'd1', entryId: 'e2', key: 'deck:d1:e2:',
          exports: [{ id: 9, name: 'other', v0: 0.22 }], midiMappings: [],
        },
      });
      manager.onEngineUpdate();
      expect(transport.sent).toContainEqual(ring(4, 0.22));
      expect(transport.sent).not.toContainEqual(ring(4, 0.2 + GAINED));
    });

    it('mixer: the hue ring tracks the optimistic per-channel hue, and a focus switch adopts the NEW channel\'s hue', async () => {
      let snap = mixerSnap(); // focused ch_a, hue 100°
      const { manager, transport, ft } = setupV2Mixer(() => snap);
      await manager.start();
      transport.emit([0xb0, 1, 67]); // hue turn on ch_a
      ft.flushDue();
      const optimisticDeg = 100 + GAINED * 360; // 105.4°
      // The flush repaints the ring from ch_a's optimistic hue immediately
      // (the snapshot still reads 100° — echo in flight).
      expect(transport.sent).toContainEqual([0xb0, 1, Math.round((optimisticDeg / 360) * 127)]);
      transport.sent.length = 0;
      // Focus switches to ch_b (hue 200°) with ch_a's echo still in flight:
      // the per-channel anchor keying means ch_b's ring reads ITS OWN entry
      // (none) — snapshot hue, never ch_a's optimistic value.
      snap = mixerSnap({}, { layer: 1, id: 'ch_b', key: 'mixer:ch_b:e:', hue: 200 });
      manager.onEngineUpdate();
      expect(transport.sent).toContainEqual([0xb0, 1, Math.round((200 / 360) * 127)]);
      expect(transport.sent).not.toContainEqual([0xb0, 1, Math.round((optimisticDeg / 360) * 127)]);
    });
  });
});
