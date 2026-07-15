// Driver #3 (Intech VSN1) coverage: the SHIPPED midi_profiles/vsn1.yaml
// validates + maps the way the bundle's yaml-transformer feeds it, the resolver
// scales the absolute jog CC to 0..1, and the manager's SELECTED-SLOT runtime
// (last key pressed = selection; soft-takeover pickup guard; jog-before-any-key
// ignored; jog-press reset) drives the two new dispatch methods.
//
// The yaml is parsed with js-yaml (a devDependency) to mirror the metro
// yaml-transformer at build time — vitest has no yaml transform configured.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { validateProfile, ProfileValidationError } from './profile';
import { resolveEvent } from './resolver';
import { decodeMidi } from './midi_message';
import { MidiManager, MidiEngineSnapshot } from './manager';
import { MidiTransport, MidiEndpoint, MidiMessageEvent } from './transport';
import { MidiDispatchApi, MidiDispatchContext, createDispatcher } from './dispatch';

const rawVsn1 = yaml.load(readFileSync(join(__dirname, '../../midi_profiles/vsn1.yaml'), 'utf8'));

// ── Profile layer ───────────────────────────────────────────────────────────
describe('shipped midi_profiles/vsn1.yaml', () => {
  it('validates and loads as a flat (context-agnostic) profile', () => {
    const p = validateProfile(rawVsn1, 'vsn1.yaml');
    expect(p.device.id).toBe('vsn1');
    expect(p.device.nameContains).toBe('Intech Grid MIDI device');
    // A flat controls list normalises to the synthetic single 'default' context.
    expect(Object.keys(p.contexts)).toEqual(['default']);
  });

  it('maps keys note 32..39 → global-effect slots 1..8 (top-left = slot 1)', () => {
    const p = validateProfile(rawVsn1, 'vsn1.yaml');
    for (let i = 0; i < 8; i += 1) {
      const note = 32 + i;
      const r = resolveEvent(p, decodeMidi([0x90, note, 127]));
      expect(r?.resolved).toEqual({ kind: 'globalEffectSlot', slot: i + 1 });
    }
  });

  // KEYED VALUE CONTRACT (firmware redeploy 2026-07-11; replaces the CC 40
  // stream, which the firmware could only emit as relative 63/65 codes): the
  // encoder value CC ADDRESSES ITS SLOT — channel = page (0-3), controller =
  // 32+k (key 0-7), value = absolute 0..127. Flat slot id = 8*channel + k + 1.
  // Resolves a CONCRETE effectIntensitySlot (no selection, no pickup guard).
  it('maps CC (ch=page, 32+k) → effectIntensitySlot slot=8*ch+k+1, across ALL pages/keys', () => {
    const p = validateProfile(rawVsn1, 'vsn1.yaml');
    for (let ch = 0; ch < 4; ch += 1) {
      for (let k = 0; k < 8; k += 1) {
        const r = resolveEvent(p, decodeMidi([0xb0 | ch, 32 + k, 100]));
        expect(r?.controlId).toBe('key_values');
        expect(r?.continuous).toBe(true);
        expect(r?.resolved).toEqual({
          kind: 'effectIntensitySlot', slotId: 8 * ch + k + 1, value: 100 / 127,
        });
      }
    }
  });

  it('scales the keyed value 0 / 64 / 127 → 0 / 64∕127 / 1', () => {
    const p = validateProfile(rawVsn1, 'vsn1.yaml');
    expect(resolveEvent(p, decodeMidi([0xb0, 32, 0]))?.resolved)
      .toEqual({ kind: 'effectIntensitySlot', slotId: 1, value: 0 });
    expect(resolveEvent(p, decodeMidi([0xb0, 32, 64]))?.resolved)
      .toEqual({ kind: 'effectIntensitySlot', slotId: 1, value: 64 / 127 });
    expect(resolveEvent(p, decodeMidi([0xb0, 32, 127]))?.resolved)
      .toEqual({ kind: 'effectIntensitySlot', slotId: 1, value: 1 });
  });

  // CC 40 no longer carries values — it is UNBOUND inbound (loud silence).
  // (The OUTBOUND page feedback still rides CC 40 on the feedback channel.)
  it('CC 40 no longer resolves on ANY channel (unbound — loud silence)', () => {
    const p = validateProfile(rawVsn1, 'vsn1.yaml');
    for (const ch of [0, 1, 2, 3]) {
      expect(resolveEvent(p, decodeMidi([0xb0 | ch, 40, 100]))).toBeNull();
    }
  });

  // Effects v2 (Sina 2026-07-08): the encoder press is now the slot's MODE
  // control, not intensity reset. Intensity reset moved to the CaptainPad UI.
  it('maps note 40 → effectModeCycle (discrete), Note Off swallowed', () => {
    const p = validateProfile(rawVsn1, 'vsn1.yaml');
    const press = resolveEvent(p, decodeMidi([0x90, 40, 127]));
    expect(press).toEqual({ controlId: 'jog_press_mode', continuous: false, resolved: { kind: 'effectModeCycle' } });
    expect(resolveEvent(p, decodeMidi([0x80, 40, 0]))).toBeNull(); // Note Off ignored
  });

  // Effects v2 (2026-07-09): the four SMALL PANEL buttons sb_0..sb_3 (notes
  // 41..44) NO LONGER select pages — paging is the PHYSICAL side button's
  // firmware-native job (it emits pageCc 40; the host follows it). Each small
  // button resolves to a host-owned `vsn1SmallButton` (sb_0 view mode, sb_1
  // no-op, sb_2 reset-all, sb_3 disable-all).
  it('maps small buttons (notes 41..44) → vsn1SmallButton 0..3', () => {
    const p = validateProfile(rawVsn1, 'vsn1.yaml');
    for (let i = 0; i < 4; i += 1) {
      const note = 41 + i;
      const r = resolveEvent(p, decodeMidi([0x90, note, 127]));
      expect(r?.resolved).toEqual({ kind: 'vsn1SmallButton', button: i });
      expect(resolveEvent(p, decodeMidi([0x80, note, 0]))).toBeNull(); // Note Off ignored
    }
  });

  it('resolves identically in deck and mixer contexts (context-agnostic map)', () => {
    const p = validateProfile(rawVsn1, 'vsn1.yaml');
    for (const bytes of [[0x90, 32, 127], [0xb1, 34, 100], [0x90, 40, 127]] as number[][]) {
      expect(resolveEvent(p, decodeMidi(bytes), 'mixer')).toEqual(resolveEvent(p, decodeMidi(bytes), 'deck'));
    }
  });

  it('validates without throwing ProfileValidationError', () => {
    expect(() => validateProfile(rawVsn1, 'vsn1.yaml')).not.toThrow(ProfileValidationError);
  });
});

// ── Manager: SELECTED-SLOT runtime + pickup guard ───────────────────────────

const vsn1Endpoints: MidiEndpoint[] = [
  { id: 'in-0', name: 'Intech Grid MIDI device', portIndex: 0, kind: 'source' },
  { id: 'out-0', name: 'Intech Grid MIDI device', portIndex: 0, kind: 'destination' },
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
  send(bytes: number[]) { if (!this.openedDest) throw new Error('no dest opened'); this.sent.push(bytes); }
  addListener(event: 'midiMessage', cb: (e: MidiMessageEvent) => void): () => void;
  addListener(event: 'endpointsChanged', cb: () => void): () => void;
  addListener(event: 'midiMessage' | 'endpointsChanged', cb: ((e: MidiMessageEvent) => void) | (() => void)) {
    if (event === 'midiMessage') { this.msgCbs.add(cb as (e: MidiMessageEvent) => void); return () => this.msgCbs.delete(cb as (e: MidiMessageEvent) => void); }
    this.epCbs.add(cb as () => void); return () => this.epCbs.delete(cb as () => void);
  }
  close() { this.msgCbs.clear(); this.epCbs.clear(); }
  emit(data: number[], timestampMs = 0) { for (const cb of this.msgCbs) cb({ sourceId: this.openedSource ?? '', data, timestampMs }); }
}

function makeApi(): MidiDispatchApi {
  const ok = async () => ({ ok: true });
  return {
    updateParamCenter: vi.fn(ok), updateMixerMaster: vi.fn(ok), setActivePattern: vi.fn(ok),
    setGlobalBlackout: vi.fn(ok), setGlobalEffect: vi.fn(ok), setSectionBrightness: vi.fn(ok),
    setGroupFixedColor: vi.fn(ok), updateMixerChannel: vi.fn(ok), updateDeckChannel: vi.fn(ok),
    dispatchGlobalEffectSlotAction: vi.fn(ok), setGlobalEffectBlackout: vi.fn(ok),
    setGlobalEffectSlotIntensity: vi.fn(ok), resetGlobalEffectSlotIntensity: vi.fn(ok),
    setEffectsPage: vi.fn(ok), cycleGlobalEffectSlotMode: vi.fn(ok), nextEffectBank: vi.fn(ok),
    resetAllGlobalEffects: vi.fn(ok), disableAllGlobalEffects: vi.fn(ok),
    setChannelPlaylistEntry: vi.fn(ok),
    setDeckChannelControl: vi.fn(ok), setMixerChannelControl: vi.fn(ok),
    setChannelHue: vi.fn(ok),
    toggleDeckMixerView: vi.fn(ok), toggleCombinedAutopilot: vi.fn(ok), toggleMasterFade: vi.fn(ok), summonPerformanceDialog: vi.fn(ok),
  };
}

const baseSnap: MidiEngineSnapshot = {
  blackout: false, activePattern: null, patterns: [], globalEffects: {},
  layers: [], deckLayer: null, activeContext: 'deck',
  globalEffectSlots: [
    { slot: 1, active: false, behavior: 'toggle', intensity: 0.5, intensityDefault: 0.5 },
    { slot: 2, active: false, behavior: 'toggle', intensity: 0.2, intensityDefault: 1.0 },
  ],
  colorPalettes: [], focused: null, syncOwnedKeys: new Set<string>(),
};

// Drain the coalescer's leading-edge async flush (runDispatch is a microtask).
const drain = () => new Promise((r) => setTimeout(r, 0));

function setup(snap: MidiEngineSnapshot = baseSnap, coalesceMs = 0) {
  const transport = new FakeTransport(vsn1Endpoints);
  const api = makeApi();
  const profile = validateProfile(rawVsn1, 'vsn1.yaml');
  const manager = new MidiManager({
    profiles: [profile], transportFactory: () => transport, api,
    getSnapshot: () => snap, defaultContext: 'deck', coalesceMs, reconnectDebounceMs: 0,
  });
  return { transport, api, manager };
}

// ── DRUM-view slot-key contract (the DEFAULT view) ───────────────────────────
// In DRUM view every key press fires IMMEDIATELY — select the pressed slot +
// dispatch its behavior-aware action, every press; no two-step. A TOGGLE slot
// flips on the first press; a TRIGGER slot fires on every press; a slot with
// no threaded behavior still fires (fails safe to 'toggle'). UI taps are
// unaffected (a separate direct path). The manager boots in DRUM, so these run
// against the default mode; the EFFECT-view two-step contract is covered in
// its own block below.
const drumSnap: MidiEngineSnapshot = {
  ...baseSnap,
  globalEffectSlots: [
    { slot: 1, active: false, behavior: 'toggle', intensity: 0.5, intensityDefault: 0.5 },
    { slot: 2, active: false, behavior: 'toggle', intensity: 0.2, intensityDefault: 1.0 },
    { slot: 3, active: false, behavior: 'trigger', intensity: 0.5, intensityDefault: 0.5 },
    { slot: 4, active: false, intensity: 0.5, intensityDefault: 0.5 }, // no behavior (snapshot race)
  ],
};

describe('VSN1 drum-always slot key (fire immediately)', () => {
  it('a TOGGLE slot fires immediately on the FIRST press (no two-step select)', async () => {
    const { manager, api, transport } = setup(drumSnap);
    await manager.start();
    transport.emit([0x90, 32, 127]); // slot 1 — one press = fire
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledTimes(1);
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(1, 'toggle');
  });

  it('a TOGGLE slot fires again on every subsequent press (toggle each press)', async () => {
    const { manager, api, transport } = setup(drumSnap);
    await manager.start();
    transport.emit([0x90, 32, 127]); // fire
    transport.emit([0x90, 32, 127]); // fire again
    transport.emit([0x90, 32, 127]); // and again
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledTimes(3);
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenNthCalledWith(3, 1, 'toggle');
  });

  it('pressing a DIFFERENT slot fires THAT slot immediately (no select-first gate)', async () => {
    const { manager, api, transport } = setup(drumSnap);
    await manager.start();
    transport.emit([0x90, 32, 127]); // fire slot 1
    (api.dispatchGlobalEffectSlotAction as ReturnType<typeof vi.fn>).mockClear();
    transport.emit([0x90, 33, 127]); // press slot 2 (different) → fires immediately
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledTimes(1);
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(2, 'toggle');
  });

  it('a TRIGGER slot fires immediately on the FIRST press (select + trigger)', async () => {
    const { manager, api, transport } = setup(drumSnap);
    await manager.start();
    transport.emit([0x90, 34, 127]); // slot 3 = trigger
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(3, 'trigger');
  });

  it('a TRIGGER slot fires on EVERY press (hand-drummed)', async () => {
    const { manager, api, transport } = setup(drumSnap);
    await manager.start();
    transport.emit([0x90, 34, 127]);
    transport.emit([0x90, 34, 127]);
    transport.emit([0x90, 34, 127]);
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledTimes(3);
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenNthCalledWith(3, 3, 'trigger');
  });

  it('an UNKNOWN/absent behavior fires immediately, FAILING SAFE to toggle', async () => {
    const { manager, api, transport } = setup(drumSnap);
    await manager.start();
    transport.emit([0x90, 35, 127]); // slot 4, no behavior field → fires as toggle
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledTimes(1);
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(4, 'toggle');
  });

  it('a keyed value write is independent of the key press (its own addressed slot)', async () => {
    // The fire-immediately key press and the keyed value CC are independent
    // paths: the value message carries its own target slot (it never depended on
    // any selection), so it writes regardless of which key was pressed.
    const { manager, api, transport } = setup(drumSnap);
    await manager.start();
    transport.emit([0x90, 32, 127]); await drain(); // slot 1 fires (toggle)
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(1, 'toggle');
    transport.emit([0xb0, 32, 64]); await drain(); // keyed value → slot 1 write
    expect(api.setGlobalEffectSlotIntensity).toHaveBeenCalledWith(1, 64 / 127);
  });
});

// ── Small buttons — Sina's map (2026-07-10 evening) ─────────────────────────
// sb_0 = MODE (cycle the SELECTED effect's mode, same runtime path as the
// encoder press) · sb_1 = VIEW (toggle grid ↔ readout; presentation only,
// keys stay drum) · sb_2 = BANK CYCLE (next named effect bank) · sb_3 = MarsinLED
// logo (the welcome-screen CC; the next press/feedback dismisses it on-device).
// NB drumSnap carries no activeBankId, so sb_2 here REFUSES to cycle (no blind
// default) — nothing is sent and nothing dispatched; the seeded BANK cycle + its
// anti-spurious-flip guards are covered in effects_v2.test.ts.
describe('VSN1 small buttons (mode / view / bank / logo)', () => {
  it('sb_0 cycles the SELECTED slot mode (after a key press selects it)', async () => {
    const { manager, api, transport } = setup(drumSnap);
    await manager.start();
    transport.emit([0x90, 33, 127], 0); // key 2 → fires + selects slot 2
    transport.emit([0x90, 41, 127], 100); // sb_0 → mode cycle on slot 2
    expect(api.cycleGlobalEffectSlotMode).toHaveBeenCalledWith(2);
  });

  it('sb_0 with NO selection yet is inert (no mode call)', async () => {
    const { manager, api, transport } = setup(drumSnap);
    await manager.start();
    transport.emit([0x90, 41, 127], 0); // no key pressed before
    expect(api.cycleGlobalEffectSlotMode).not.toHaveBeenCalled();
  });

  it('sb_1 toggles the LCD view: grid (1) → readout (0) → grid (1)', async () => {
    const { manager, transport } = setup(drumSnap);
    await manager.start();
    transport.sent.length = 0;
    transport.emit([0x90, 42, 127], 0); // grid (default) → readout
    expect(transport.sent).toContainEqual([0xb2, 43, 0]);
    transport.emit([0x90, 42, 127], 200); // readout → grid
    expect(transport.sent).toContainEqual([0xb2, 43, 1]);
  });

  it('keys still fire immediately in BOTH views (view is presentation only)', async () => {
    const { manager, api, transport } = setup(drumSnap);
    await manager.start();
    transport.emit([0x90, 42, 127], 0);   // switch to the READOUT view
    transport.emit([0x90, 32, 127], 100); // key → still fires now (drum contract)
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(1, 'toggle');
  });

  it('sb_2 on an UNSEEDED snapshot refuses (nothing sent, nothing dispatched)', async () => {
    // drumSnap has no activeBankId → sb_2 refuses the cycle (no blind default),
    // so it neither sends a MIDI frame nor dispatches any slot/reset action.
    const { manager, api, transport } = setup(drumSnap);
    await manager.start();
    transport.sent.length = 0;
    transport.emit([0x90, 43, 127], 0);
    expect(transport.sent).toHaveLength(0);
    expect(api.dispatchGlobalEffectSlotAction).not.toHaveBeenCalled();
    expect(api.resetAllGlobalEffects).not.toHaveBeenCalled();
    expect(api.nextEffectBank).not.toHaveBeenCalled();
  });

  it('sb_3 shows the MarsinLED logo (the welcome CC, one-shot)', async () => {
    const { manager, transport } = setup(drumSnap);
    await manager.start();
    transport.sent.length = 0;
    transport.emit([0x90, 44, 127], 0);
    expect(transport.sent).toContainEqual([0xb2, 41, 1]); // welcome/logo CC
  });
});

describe('VSN1 selected-slot runtime', () => {
  it('a key press selects the slot AND dispatches its behavior-aware toggle (fire immediately)', async () => {
    // Default (DRUM) view: a key press SELECTS the slot AND dispatches its
    // behavior-aware action on the SAME press — the two-step select-then-commit
    // applies only in EFFECT view (see the EFFECT-view block above).
    const { manager, api, transport } = setup();
    await manager.start();
    transport.emit([0x90, 33, 127]); // key 2 → slot 2, fires immediately
    expect(api.dispatchGlobalEffectSlotAction).toHaveBeenCalledWith(2, 'toggle');
  });

  // ── Keyed value writes (firmware 2026-07-11): self-addressed, no selection,
  // no pickup guard. The device renders its displayed value from OUR feedback
  // stream, so its absolute position is anchored on the slot's live value by
  // construction — a host-side takeover lock would only swallow legit writes.
  it('a keyed value CC writes its addressed slot IMMEDIATELY — no pickup lock', async () => {
    const { manager, api, transport } = setup();
    await manager.start();
    // No key press, value far from the slot's live 0.5 — writes anyway.
    transport.emit([0xb0, 32, 0]); await drain();
    expect(api.setGlobalEffectSlotIntensity).toHaveBeenCalledWith(1, 0);
  });

  it('a keyed value CC needs NO selection (the message addresses its own slot)', async () => {
    const { manager, api, transport } = setup();
    await manager.start();
    transport.emit([0xb0, 33, 100]); await drain(); // key 1 on page 0 → slot 2
    expect(api.setGlobalEffectSlotIntensity).toHaveBeenCalledWith(2, 100 / 127);
  });

  it('a keyed value CC on channel 1 (page 1) addresses slot 9 — even if unthreaded', async () => {
    // The write is self-addressed and dispatches regardless of whether the
    // snapshot has threaded that slot; the ENGINE is the validator (fail-loud
    // 404 on a genuinely absent slot, surfaced by the dispatch result path).
    const { manager, api, transport } = setup();
    await manager.start();
    transport.emit([0xb1, 32, 64]); await drain(); // ch 1, key 0 → slot 9
    expect(api.setGlobalEffectSlotIntensity).toHaveBeenCalledWith(9, 64 / 127);
  });

  it('two DIFFERENT keys turned inside one coalescer window BOTH write (per-slot keying)', async () => {
    // 30 ms window, real timers: both CCs land back-to-back, well inside one
    // window. Per-slot coalescer keys give each slot its own leading edge; a
    // shared key would last-write-wins slot 1's value away.
    const { manager, api, transport } = setup(baseSnap, 30);
    await manager.start();
    transport.emit([0xb0, 32, 64]);  // slot 1
    transport.emit([0xb0, 33, 127]); // slot 2 — same window
    await drain();
    expect(api.setGlobalEffectSlotIntensity).toHaveBeenCalledWith(1, 64 / 127);
    expect(api.setGlobalEffectSlotIntensity).toHaveBeenCalledWith(2, 1);
  });

  // Effects v2: the jog PRESS now cycles the SELECTED slot's mode (was reset).
  it('the jog press cycles the SELECTED slot mode', async () => {
    const { manager, api, transport } = setup();
    await manager.start();
    transport.emit([0x90, 32, 127]); // select slot 1
    transport.emit([0x90, 40, 127]); // jog press → mode cycle
    expect(api.cycleGlobalEffectSlotMode).toHaveBeenCalledWith(1);
    // It is NOT the old intensity reset any more.
    expect(api.resetGlobalEffectSlotIntensity).not.toHaveBeenCalled();
  });

  it('the jog press with NO selection is inert (no mode cycle)', async () => {
    const { manager, api, transport } = setup();
    await manager.start();
    transport.emit([0x90, 40, 127]);
    expect(api.cycleGlobalEffectSlotMode).not.toHaveBeenCalled();
  });

  it('a keyed value write works even when the slot has not threaded its intensity', async () => {
    // The old selected-slot path needed the snapshot intensity as a pickup
    // anchor; the keyed path has NO pickup (the device anchors on our feedback),
    // so an unthreaded slot still writes — the engine is the validator.
    const noIntensity: MidiEngineSnapshot = {
      ...baseSnap,
      globalEffectSlots: [{ slot: 1, active: false, behavior: 'toggle' }], // no intensity field
    };
    const { manager, api, transport } = setup(noIntensity);
    await manager.start();
    transport.emit([0xb0, 32, 100]); await drain();
    expect(api.setGlobalEffectSlotIntensity).toHaveBeenCalledWith(1, 100 / 127);
  });
});

// ── Dispatcher: the two runtime-built slot-carrying kinds + raw-form guard ───
const baseCtx: MidiDispatchContext = {
  getBlackout: () => false,
  getGlobalEffectState: () => false,
  resolvePatternForBank: () => null,
  getLayer: () => null,
  getColorPalette: () => null,
  getBpmSpeedSyncOn: () => false,
  getGlobalEffectSlotBehavior: () => null,
};

describe('dispatcher — VSN1 intensity kinds', () => {
  it('effectIntensitySlot → setGlobalEffectSlotIntensity(slotId, value)', async () => {
    const api = makeApi();
    const r = await createDispatcher(api, baseCtx)({ kind: 'effectIntensitySlot', slotId: 3, value: 0.7 });
    expect(api.setGlobalEffectSlotIntensity).toHaveBeenCalledWith(3, 0.7);
    expect(r).toEqual({ ok: true });
  });

  it('effectIntensitySlotReset → resetGlobalEffectSlotIntensity(slotId)', async () => {
    const api = makeApi();
    await createDispatcher(api, baseCtx)({ kind: 'effectIntensitySlotReset', slotId: 5 });
    expect(api.resetGlobalEffectSlotIntensity).toHaveBeenCalledWith(5);
  });

  it('the RAW slotless jog kinds THROW in the dispatcher (runtime must resolve them)', async () => {
    const api = makeApi();
    await expect(createDispatcher(api, baseCtx)({ kind: 'effectIntensityAbs', value: 0.5 })).rejects.toThrow(/controller runtime/);
    await expect(createDispatcher(api, baseCtx)({ kind: 'effectIntensityReset' })).rejects.toThrow(/controller runtime/);
  });

  it('threads a failed api result back (fail-loud, P2-5)', async () => {
    const api = makeApi();
    (api.setGlobalEffectSlotIntensity as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ ok: false, error: 'engine 404' });
    const r = await createDispatcher(api, baseCtx)({ kind: 'effectIntensitySlot', slotId: 1, value: 0.3 });
    expect(r).toEqual({ ok: false, error: 'engine 404' });
  });
});
